import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type RecipeItemInput = {
  ingredientId: string;
  quantity: Prisma.Decimal;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status }
  );
}

function parsePositiveDecimal(value: unknown) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+(\.\d{1,3})?$/.test(text)) {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(text);

    if (
      !decimal.isFinite() ||
      decimal.lte(0) ||
      decimal.gt("99999999999.999")
    ) {
      return null;
    }

    return decimal;
  } catch {
    return null;
  }
}

function parseItems(
  value: unknown,
  productId: string
):
  | { items: RecipeItemInput[]; error?: never }
  | { items?: never; error: string } {
  if (!Array.isArray(value)) {
    return {
      error: "Malzeme listesi geçersiz.",
    };
  }

  if (value.length < 1 || value.length > 100) {
    return {
      error: "Reçete 1 ile 100 arasında malzeme içermelidir.",
    };
  }

  const seen = new Set<string>();
  const items: RecipeItemInput[] = [];

  for (const rawItem of value) {
    if (
      !rawItem ||
      typeof rawItem !== "object" ||
      Array.isArray(rawItem)
    ) {
      return {
        error: "Malzeme bilgileri geçersiz.",
      };
    }

    const ingredientId = rawItem.ingredientId;

    if (
      typeof ingredientId !== "string" ||
      !ingredientId.trim()
    ) {
      return {
        error: "Malzeme seçimi zorunludur.",
      };
    }

    if (ingredientId === productId) {
      return {
        error:
          "Bir ürün kendi reçetesinde malzeme olamaz.",
      };
    }

    if (seen.has(ingredientId)) {
      return {
        error:
          "Aynı malzeme bir reçeteye birden fazla eklenemez.",
      };
    }

    const quantity = parsePositiveDecimal(
      rawItem.quantity
    );

    if (!quantity) {
      return {
        error:
          "Malzeme miktarı pozitif ve en fazla 3 ondalıklı olmalıdır.",
      };
    }

    seen.add(ingredientId);

    items.push({
      ingredientId,
      quantity,
    });
  }

  return { items };
}

// ==========================================
// PATCH - UPDATE RECIPE
// ==========================================

async function handlePATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse(
        "Oturum açmanız gerekiyor.",
        401
      );
    }

    const { id } = await context.params;

    if (!id) {
      return errorResponse(
        "Reçete ID gereklidir.",
        400
      );
    }

    const organizationId = membership.organizationId;

    const body: unknown = await request
      .json()
      .catch(() => null);

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Geçersiz istek verisi.",
        400
      );
    }

    const data = body as Record<string, unknown>;

    // Reçetenin bu organizasyona ait olduğunu doğrula.
    const existingRecipe = await prisma.recipe.findFirst({
      where: {
        id,
        organizationId,
      },
      select: {
        id: true,
        productId: true,
      },
    });

    if (!existingRecipe) {
      return errorResponse(
        "Reçete bulunamadı.",
        404
      );
    }

    // Güncellenebilir alanlar
    const updateData: Prisma.RecipeUpdateInput = {};

    if (data.name !== undefined) {
      if (
        data.name !== null &&
        typeof data.name !== "string"
      ) {
        return errorResponse(
          "Reçete adı geçersiz.",
          400
        );
      }

      const name =
        typeof data.name === "string"
          ? data.name.trim()
          : "";

      if (name.length > 200) {
        return errorResponse(
          "Reçete adı en fazla 200 karakter olabilir.",
          400
        );
      }

      updateData.name = name || null;
    }

    if (data.yieldQuantity !== undefined) {
      const yieldQuantity = parsePositiveDecimal(
        data.yieldQuantity
      );

      if (!yieldQuantity) {
        return errorResponse(
          "Üretim miktarı pozitif ve en fazla 3 ondalıklı olmalıdır.",
          400
        );
      }

      updateData.yieldQuantity = yieldQuantity;
    }

    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return errorResponse(
          "Aktiflik durumu geçersiz.",
          400
        );
      }

      updateData.isActive = data.isActive;
    }

    // MVP: Reçetenin bağlı olduğu ürün değiştirilmiyor.
    // Ürün değişimi gerekiyorsa yeni reçete oluşturulmalı.
    if (data.productId !== undefined) {
      return errorResponse(
        "Reçetenin bağlı olduğu ürün değiştirilemez.",
        400
      );
    }

    let parsedItems: RecipeItemInput[] | undefined;

    if (data.items !== undefined) {
      const result = parseItems(
        data.items,
        existingRecipe.productId
      );

      if (result.error) {
        return errorResponse(result.error, 400);
      }

      parsedItems = result.items;
    }

    if (
      Object.keys(updateData).length === 0 &&
      parsedItems === undefined
    ) {
      return errorResponse(
        "Güncellenecek alan bulunamadı.",
        400
      );
    }

    // Malzemeler gönderildiyse organizasyon ve
    // aktif ürün kontrollerini yap.
    if (parsedItems !== undefined) {
      const ingredientIds = parsedItems.map(
        (item) => item.ingredientId
      );

      const validIngredients = await prisma.product.count({
        where: {
          id: {
            in: ingredientIds,
          },
          organizationId,
          isActive: true,
        },
      });

      if (validIngredients !== ingredientIds.length) {
        return errorResponse(
          "Malzemelerden biri bulunamadı veya aktif değil.",
          400
        );
      }
    }

    // Tek transaction:
    // - Reçete alanlarını güncelle
    // - Malzemeler gönderildiyse eskilerini sil
    // - Yeni malzemeleri ekle
    const updatedRecipe = await prisma.$transaction(
      async (tx) => {
        // Transaction içinde sahipliği yeniden doğrula.
        // Böylece silinmiş veya değiştirilmiş reçeteye
        // işlem yapılması engellenir.
        const currentRecipe = await tx.recipe.findFirst({
          where: {
            id,
            organizationId,
          },
          select: {
            id: true,
          },
        });

        if (!currentRecipe) {
          throw new Error("RECIPE_NOT_FOUND");
        }

        if (parsedItems !== undefined) {
          await tx.recipeItem.deleteMany({
            where: {
              recipeId: id,
            },
          });
        }

        const recipe = await tx.recipe.update({
          where: {
            id,
            organizationId,
          },
          data: {
            ...updateData,

            ...(parsedItems !== undefined
              ? {
                  items: {
                    create: parsedItems.map((item) => ({
                      quantity: item.quantity,
                      ingredient: {
                        connect: {
                          id: item.ingredientId,
                        },
                      },
                    })),
                  },
                }
              : {}),
          },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
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

        await writeAudit(tx, membership, "recipe.update", "Recipe", recipe.id);
        return recipe;
      }
    );

    return NextResponse.json({
      message: "Reçete başarıyla güncellendi.",
      recipe: updatedRecipe,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "RECIPE_NOT_FOUND"
    ) {
      return errorResponse(
        "Reçete bulunamadı.",
        404
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2025") {
        return errorResponse(
          "Reçete veya malzeme bulunamadı.",
          404
        );
      }

      if (error.code === "P2003") {
        return errorResponse(
          "Geçersiz malzeme ilişkisi.",
          400
        );
      }

      if (error.code === "P2002") {
        return errorResponse(
          "Bu malzeme reçetede zaten bulunuyor.",
          409
        );
      }
    }

    console.error("PATCH /api/recipes/[id]:", error instanceof Error ? error.name : "UnknownError");

    return errorResponse(
      "Reçete güncellenirken bir hata oluştu.",
      500
    );
  }
}

// ==========================================
// DELETE - DELETE RECIPE
// ==========================================

async function handleDELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse(
        "Oturum açmanız gerekiyor.",
        401
      );
    }

    const { id } = await context.params;

    if (!id) {
      return errorResponse(
        "Reçete ID gereklidir.",
        400
      );
    }

    const organizationId = membership.organizationId;

    // Organizasyon kapsamıyla sil.
    // RecipeItem ilişkisi onDelete: Cascade olduğu için
    // malzemeler de otomatik silinir.
    const result = await prisma.$transaction(async tx => {
    const deleted = await tx.recipe.deleteMany({
      where: {
        id,
        organizationId,
      },
    });

    if (deleted.count) await writeAudit(tx, membership, "recipe.delete", "Recipe", id);
    return deleted;
    });
    if (result.count === 0) {
      return errorResponse(
        "Reçete bulunamadı.",
        404
      );
    }

    return NextResponse.json({
      message: "Reçete başarıyla silindi.",
    });
  } catch (error) {
    console.error("DELETE /api/recipes/[id]:", error instanceof Error ? error.name : "UnknownError");

    return errorResponse(
      "Reçete silinirken bir hata oluştu.",
      500
    );
  }
}

export const PATCH = withPermission("recipes.manage", handlePATCH);

export const DELETE = withPermission("recipes.manage", handleDELETE);
