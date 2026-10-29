import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { Prisma } from "@/generated/prisma/client";

// ======================================================
// HELPERS
// ======================================================

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parsePositiveDecimal(value: unknown) {
  if (
    (typeof value !== "string" &&
      typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(value);

    if (
      !decimal.isFinite() ||
      decimal.lte(0) ||
      decimal.decimalPlaces() > 3 ||
      decimal.gt("99999999999.999")
    ) {
      return null;
    }

    return decimal;
  } catch {
    return null;
  }
}

// ======================================================
// GET /api/recipes
// Organizasyon reçetelerini listele
// ======================================================

async function handleGET() {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse("Yetkisiz işlem.", 401);
    }

    const recipes = await prisma.recipe.findMany({
      where: {
        organizationId: membership.organizationId,
      },

      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            costPrice: true,
            unit: true,
            isActive: true,
          },
        },

        items: {
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                costPrice: true,
                isActive: true,
              },
            },
          },

          orderBy: {
            createdAt: "asc",
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    const serializedRecipes = recipes.map((recipe) => {
      const totalCost = recipe.items.reduce(
        (sum, item) => {
          if (item.ingredient.costPrice === null) {
            return sum;
          }

          return sum.plus(
            item.quantity.mul(item.ingredient.costPrice)
          );
        },
        new Prisma.Decimal(0)
      );

      const hasMissingCosts = recipe.items.some(
        (item) => item.ingredient.costPrice === null
      );

      const costPerUnit = totalCost.div(
        recipe.yieldQuantity
      );

      return {
        ...recipe,

        yieldQuantity: recipe.yieldQuantity.toString(),

        product: {
          ...recipe.product,
          price: recipe.product.price.toString(),
          costPrice:
            recipe.product.costPrice?.toString() ?? null,
        },

        items: recipe.items.map((item) => ({
          ...item,
          quantity: item.quantity.toString(),

          ingredient: {
            ...item.ingredient,
            costPrice:
              item.ingredient.costPrice?.toString() ??
              null,
          },
        })),

        totalCost: hasMissingCosts
          ? null
          : totalCost.toDecimalPlaces(2).toString(),

        costPerUnit: hasMissingCosts
          ? null
          : costPerUnit.toDecimalPlaces(2).toString(),

        hasMissingCosts,
      };
    });

    return NextResponse.json({
      recipes: serializedRecipes,
    });
  } catch (error) {
    console.error("GET_RECIPES_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return errorResponse(
      "Reçeteler alınırken bir hata oluştu.",
      500
    );
  }
}

// ======================================================
// POST /api/recipes
// Yeni reçete oluştur
// ======================================================

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse("Yetkisiz işlem.", 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Geçersiz JSON verisi.", 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse("Geçersiz reçete verisi.", 400);
    }

    const data = body as Record<string, unknown>;

    const productId =
      typeof data.productId === "string"
        ? data.productId.trim()
        : "";

    const name =
      typeof data.name === "string"
        ? data.name.trim()
        : "";

    const yieldQuantity = parsePositiveDecimal(
      data.yieldQuantity ?? 1
    );

    const isActive =
      typeof data.isActive === "boolean"
        ? data.isActive
        : true;

    if (!productId) {
      return errorResponse(
        "Reçete için ürün seçimi zorunludur.",
        400
      );
    }

    if (name.length > 200) {
      return errorResponse(
        "Reçete adı 200 karakteri geçemez.",
        400
      );
    }

    if (!yieldQuantity) {
      return errorResponse(
        "Üretim miktarı sıfırdan büyük olmalı ve en fazla 3 ondalık basamak içermelidir.",
        400
      );
    }

    if (
      !Array.isArray(data.items) ||
      data.items.length === 0
    ) {
      return errorResponse(
        "Reçetede en az bir malzeme bulunmalıdır.",
        400
      );
    }

    if (data.items.length > 100) {
      return errorResponse(
        "Bir reçeteye en fazla 100 malzeme eklenebilir.",
        400
      );
    }

    const parsedItems: {
      ingredientId: string;
      quantity: Prisma.Decimal;
    }[] = [];

    for (const rawItem of data.items) {
      if (
        typeof rawItem !== "object" ||
        rawItem === null ||
        Array.isArray(rawItem)
      ) {
        return errorResponse(
          "Geçersiz malzeme bilgisi.",
          400
        );
      }

      const item = rawItem as Record<string, unknown>;

      const ingredientId =
        typeof item.ingredientId === "string"
          ? item.ingredientId.trim()
          : "";

      const quantity = parsePositiveDecimal(
        item.quantity
      );

      if (!ingredientId || !quantity) {
        return errorResponse(
          "Malzeme seçimi ve geçerli miktar zorunludur.",
          400
        );
      }

      if (ingredientId === productId) {
        return errorResponse(
          "Bir ürün kendi reçetesinde malzeme olamaz.",
          400
        );
      }

      parsedItems.push({
        ingredientId,
        quantity,
      });
    }

    const ingredientIds = parsedItems.map(
      (item) => item.ingredientId
    );

    if (
      new Set(ingredientIds).size !==
      ingredientIds.length
    ) {
      return errorResponse(
        "Aynı malzeme reçeteye birden fazla eklenemez.",
        400
      );
    }

    // ==================================================
    // ORGANIZATION VALIDATION
    // ==================================================

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId: membership.organizationId,
        isActive: true,
      },

      select: {
        id: true,
      },
    });

    if (!product) {
      return errorResponse(
        "Reçete ürünü bulunamadı veya aktif değil.",
        404
      );
    }

    const ingredients = await prisma.product.findMany({
      where: {
        id: {
          in: ingredientIds,
        },

        organizationId: membership.organizationId,
        isActive: true,
      },

      select: {
        id: true,
      },
    });

    if (ingredients.length !== ingredientIds.length) {
      return errorResponse(
        "Malzemelerden biri bulunamadı veya aktif değil.",
        400
      );
    }

    // ==================================================
    // CREATE RECIPE
    // ==================================================

    const recipe = await prisma.$transaction(async tx => {
    const created = await tx.recipe.create({
      data: {
        organizationId: membership.organizationId,
        productId,
        name: name || null,
        yieldQuantity,
        isActive,

        items: {
          create: parsedItems.map((item) => ({
            ingredientId: item.ingredientId,
            quantity: item.quantity,
          })),
        },
      },

      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },

        items: {
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                unit: true,
                costPrice: true,
              },
            },
          },
        },
      },
    });

    await writeAudit(tx, membership, "recipe.create", "Recipe", created.id);
    return created;
    });
    return NextResponse.json(
      {
        message: "Reçete başarıyla oluşturuldu.",
        recipe: {
          ...recipe,

          yieldQuantity:
            recipe.yieldQuantity.toString(),

          items: recipe.items.map((item) => ({
            ...item,

            quantity: item.quantity.toString(),

            ingredient: {
              ...item.ingredient,
              costPrice:
                item.ingredient.costPrice?.toString() ??
                null,
            },
          })),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_RECIPE_ERROR:", error instanceof Error ? error.name : "UnknownError");

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return errorResponse(
        "Bu ürün için zaten bir reçete bulunuyor.",
        409
      );
    }

    return errorResponse(
      "Reçete oluşturulurken bir hata oluştu.",
      500
    );
  }
}

export const GET = withPermission("recipes.manage", handleGET);

export const POST = withPermission("recipes.manage", handlePOST);
