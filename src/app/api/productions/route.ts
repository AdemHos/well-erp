import { mutationReplay, rememberMutation } from "@/lib/mutation-replay";
import { writeAudit } from "@/lib/audit";
import { CashError } from "@/lib/cash-management";
import { branchPolicy } from "@/lib/settings-policy";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

export const dynamic = "force-dynamic";

const MAX_RETRIES = 3;

class ProductionError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "ProductionError";
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseQuantity(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const raw = String(value).trim();

  if (!/^\d+(\.\d{1,3})?$/.test(raw)) {
    return null;
  }

  try {
    const quantity = new Prisma.Decimal(raw);

    if (
      !quantity.isFinite() ||
      quantity.lte(0) ||
      quantity.gt("1000000")
    ) {
      return null;
    }

    return quantity;
  } catch {
    return null;
  }
}

function serializeProduction(production: {
  id: string;
  organizationId: string;
  branchId: string;
  productId: string;
  productName: string;
  recipeId: string;
  recipeName: string | null;
  quantity: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  note: string | null;
  createdAt: Date;
  items: {
    id: string;
    ingredientId: string;
    ingredientName: string;
    ingredientUnit: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    totalCost: Prisma.Decimal;
  }[];
}) {
  return {
    id: production.id,
    organizationId: production.organizationId,
    branchId: production.branchId,
    productId: production.productId,
    productName: production.productName,
    recipeId: production.recipeId,
    recipeName: production.recipeName,
    quantity: production.quantity.toString(),
    totalCost: production.totalCost.toString(),
    unitCost: production.unitCost.toString(),
    note: production.note,
    createdAt: production.createdAt.toISOString(),
    items: production.items.map((item) => ({
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      ingredientUnit: item.ingredientUnit,
      quantity: item.quantity.toString(),
      unitCost: item.unitCost.toString(),
      totalCost: item.totalCost.toString(),
    })),
  };
}

// ======================================================
// GET - PRODUCTION HISTORY
// ======================================================

async function handleGET(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse("Oturum açmanız gerekiyor.", 401);
    }

    const organizationId = membership.organizationId;

    const { searchParams } = new URL(request.url);

    const branchId = searchParams.get("branchId");
    const recipeId = searchParams.get("recipeId");

    const requestedLimit = Number(
      searchParams.get("limit") ?? 50
    );

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 50;

    const productions = await prisma.production.findMany({
      where: { AND: [{
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(recipeId ? { recipeId } : {}),
      }, branchScope(membership)] },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          orderBy: {
            ingredientName: "asc",
          },
        },
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit,
    });

    return NextResponse.json({
      productions: productions.map((production) => ({
        ...serializeProduction(production),
        branch: production.branch,
      })),
      count: productions.length,
    });
  } catch (error) {
    console.error("GET /api/productions:", error instanceof Error ? error.name : "UnknownError");

    return errorResponse(
      "Üretim geçmişi getirilemedi.",
      500
    );
  }
}

// ======================================================
// POST - CREATE PRODUCTION
// ======================================================

async function handlePOST(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return errorResponse("Oturum açmanız gerekiyor.", 401);
    }

    // Only authorized staff can register production.
    

    const organizationId = membership.organizationId;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Geçersiz JSON verisi.", 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return errorResponse("Geçersiz istek verisi.", 400);
    }

    const input = body as Record<string, unknown>;

    const { branchId, recipeId } = input;
    const quantity = parseQuantity(input.quantity);

    if (
      typeof branchId !== "string" ||
      !branchId.trim()
    ) {
      return errorResponse("Şube seçimi zorunludur.", 400);
    }

    if (
      typeof recipeId !== "string" ||
      !recipeId.trim()
    ) {
      return errorResponse("Reçete seçimi zorunludur.", 400);
    }

    if (!quantity) {
      return errorResponse(
        "Üretim miktarı pozitif, en fazla üç ondalıklı ve 1.000.000 veya altında olmalıdır.",
        400
      );
    }

    if (
      input.note !== undefined &&
      input.note !== null &&
      typeof input.note !== "string"
    ) {
      return errorResponse("Üretim notu geçersiz.", 400);
    }

    const note =
      typeof input.note === "string"
        ? input.note.trim()
        : "";

    if (note.length > 500) {
      return errorResponse(
        "Üretim notu en fazla 500 karakter olabilir.",
        400
      );
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const production = await prisma.$transaction(
          async (tx) => {
            const attempt = await mutationReplay(tx, organizationId, "production.create.request", input.idempotencyKey, { branchId, recipeId, quantity: quantity.toString(), note });
            if (attempt.entityId) return tx.production.findFirstOrThrow({ where: { id: attempt.entityId, organizationId, branchId }, include: { items: true } });
            // ----------------------------------
            // 1. Validate branch
            // ----------------------------------

            const branch = await tx.branch.findFirst({
              where: {
                id: branchId,
                organizationId,
              },
              select: {
                id: true,
              },
            });

            if (!branch) {
              throw new ProductionError(
                "Şube bulunamadı.",
                404
              );
            }

            // ----------------------------------
            // 2. Load recipe and ingredients
            // ----------------------------------

            const recipe = await tx.recipe.findFirst({
              where: {
                id: recipeId,
                organizationId,
                isActive: true,
              },
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    isActive: true,
                    organizationId: true,
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
                        isActive: true,
                        organizationId: true,
                      },
                    },
                  },
                },
              },
            });

            if (!recipe) {
              throw new ProductionError(
                "Aktif reçete bulunamadı.",
                404
              );
            }

            if (
              !recipe.product.isActive ||
              recipe.product.organizationId !== organizationId
            ) {
              throw new ProductionError(
                "Üretilecek ürün aktif değil veya işletmeye ait değil."
              );
            }

            if (recipe.yieldQuantity.lte(0)) {
              throw new ProductionError(
                "Reçete çıktı miktarı geçersiz."
              );
            }

            if (recipe.items.length === 0) {
              throw new ProductionError(
                "Reçetede hammadde bulunmuyor."
              );
            }

            // ----------------------------------
            // 3. Calculate required ingredients
            // ----------------------------------

            const multiplier = quantity.div(
              recipe.yieldQuantity
            );

            const requiredItems = recipe.items.map(
              (item) => {
                const ingredient = item.ingredient;

                if (
                  !ingredient.isActive ||
                  ingredient.organizationId !== organizationId
                ) {
                  throw new ProductionError(
                    `${ingredient.name} aktif değil veya işletmeye ait değil.`
                  );
                }

                if (ingredient.id === recipe.productId) {
                  throw new ProductionError(
                    "Ürün kendi hammaddesi olamaz."
                  );
                }

                if (item.quantity.lte(0)) {
                  throw new ProductionError(
                    `${ingredient.name} için reçete miktarı geçersiz.`
                  );
                }

                if (
                  ingredient.costPrice === null ||
                  ingredient.costPrice.lt(0)
                ) {
                  throw new ProductionError(
                    `${ingredient.name} için geçerli bir maliyet tanımlanmalı.`
                  );
                }

                // BranchStock supports three decimal places.
                const requiredQuantity = item.quantity
                  .mul(multiplier)
                  .toDecimalPlaces(
                    3,
                    Prisma.Decimal.ROUND_UP
                  );

                if (
                  requiredQuantity.lte(0) ||
                  requiredQuantity.gt("99999999999.999")
                ) {
                  throw new ProductionError(
                    `${ingredient.name} için gereken miktar geçersiz.`
                  );
                }

                const unitCost = ingredient.costPrice;

                return {
                  ingredientId: ingredient.id,
                  ingredientName: ingredient.name,
                  ingredientUnit: ingredient.unit,
                  quantity: requiredQuantity,
                  unitCost,
                  totalCost: requiredQuantity.mul(unitCost),
                };
              }
            );

            // ----------------------------------
            // 4. Deduct ingredient stocks
            // ----------------------------------

            // Conditional updates prevent stock from
            // going below zero under concurrent requests.
            for (const item of requiredItems) {
              const updated = await tx.branchStock.updateMany({
                where: {
                  organizationId,
                  branchId,
                  productId: item.ingredientId,
                  quantity: {
                    gte: item.quantity,
                  },
                },
                data: {
                  quantity: {
                    decrement: item.quantity,
                  },
                },
              });

              if (updated.count !== 1) {
                throw new ProductionError(
                  `${item.ingredientName} için yeterli stok bulunmuyor.`,
                  409
                );
              }
            }

            // ----------------------------------
            // 5. Calculate costs
            // ----------------------------------

            const exactTotalCost = requiredItems.reduce(
              (sum, item) => sum.plus(item.totalCost),
              new Prisma.Decimal(0)
            );

            const totalCost = exactTotalCost.toDecimalPlaces(
              2,
              Prisma.Decimal.ROUND_HALF_UP
            );

            const unitCost = exactTotalCost
              .div(quantity)
              .toDecimalPlaces(
                4,
                Prisma.Decimal.ROUND_HALF_UP
              );

            if (
              totalCost.gte("1000000000000") ||
              unitCost.gte("10000000000")
            ) {
              throw new ProductionError(
                "Üretim maliyeti veritabanı sınırını aşıyor."
              );
            }

            // ----------------------------------
            // 6. Create production and items
            // ----------------------------------

            const created = await tx.production.create({
              data: {
                organizationId,
                branchId,
                productId: recipe.product.id,
                productName: recipe.product.name,
                recipeId: recipe.id,
                recipeName: recipe.name,
                quantity,
                totalCost,
                unitCost,
                note: note || null,
                items: {
                  create: requiredItems.map((item) => ({
                    ingredientId: item.ingredientId,
                    ingredientName: item.ingredientName,
                    ingredientUnit: item.ingredientUnit,
                    quantity: item.quantity,
                    unitCost: item.unitCost.toDecimalPlaces(
                      4,
                      Prisma.Decimal.ROUND_HALF_UP
                    ),
                    totalCost: item.totalCost.toDecimalPlaces(
                      2,
                      Prisma.Decimal.ROUND_HALF_UP
                    ),
                  })),
                },
              },
              include: {
                items: true,
              },
            });

            // ----------------------------------
            // 7. Record raw material consumption
            // ----------------------------------

            await tx.stockMovement.createMany({
              data: requiredItems.map((item) => ({
                organizationId,
                branchId,
                productId: item.ingredientId,
                type: "PRODUCTION_OUT" as const,
                quantity: item.quantity,
                reference: created.id,
                note: `Üretim tüketimi: ${recipe.product.name}`,
              })),
            });

            // ----------------------------------
            // 8. Add finished product stock
            // ----------------------------------

            await tx.branchStock.upsert({
              where: {
                branchId_productId: {
                  branchId,
                  productId: recipe.productId,
                },
              },
              create: {
                organizationId,
                branchId,
                productId: recipe.productId,
                quantity,
                criticalLevel: (await branchPolicy(tx, membership.organizationId, branchId)).defaultCriticalLevel,
              },
              update: {
                quantity: {
                  increment: quantity,
                },
              },
            });

            // ----------------------------------
            // 9. Record finished product movement
            // ----------------------------------

            await tx.stockMovement.create({
              data: {
                organizationId,
                branchId,
                productId: recipe.productId,
                type: "PRODUCTION_IN",
                quantity,
                reference: created.id,
                note: `Üretim tamamlandı: ${recipe.product.name}`,
              },
            });

            await writeAudit(tx, membership, "production.create", "Production", created.id, branchId);
            await rememberMutation(tx, membership, attempt, "production.create.request", "Production", created.id, branchId);
            return created;
          },
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 15000,
          }
        );

        return NextResponse.json(
          {
            message: "Üretim başarıyla tamamlandı.",
            production: serializeProduction(production),
          },
          { status: 201 }
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(error.code) &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }

        throw error;
      }
    }

    return errorResponse(
      "Üretim işlemi tamamlanamadı.",
      500
    );
  } catch (error) {
    if (error instanceof CashError) return errorResponse(error.message, error.status);
    if (error instanceof ProductionError) {
      return errorResponse(error.message, error.status);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError
    ) {
      if (error.code === "P2034" || error.code === "P2002") {
        return errorResponse(
          "Eşzamanlı stok işlemi oluştu. Lütfen tekrar deneyin.",
          409
        );
      }
    }

    console.error("POST /api/productions:", error instanceof Error ? error.name : "UnknownError");

    return errorResponse(
      "Üretim sırasında beklenmeyen bir hata oluştu.",
      500
    );
  }
}

export const GET = withPermission("production.manage", handleGET);

export const POST = withPermission("production.manage", handlePOST);
