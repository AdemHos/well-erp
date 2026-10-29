import { validateProductBody } from "@/lib/product-input";
import { CashError } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

// ======================================================
// PATCH /api/products/[id]
// Ürün güncelle
// ======================================================

async function handlePATCH(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const { id: productId } = await context.params;

    // ==================================================
    // PRODUCT TENANT CHECK
    // ==================================================

    const existingProduct =
      await prisma.product.findFirst({
        where: {
          id: productId,
          organizationId:
            membership.organizationId,
        },

        select: {
          id: true, unit: true,
        },
      });

    if (!existingProduct) {
      return NextResponse.json(
        {
          error: "Ürün bulunamadı.",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // BODY
    // ==================================================

    const body = await request.json().catch(() => null);
    validateProductBody(body);

    const name = body.name?.trim();

    const description =
      body.description?.trim() || null;

    const sku =
      body.sku?.trim() || null;

    const barcode =
      body.barcode?.trim() || null;

    const imageUrl =
      body.imageUrl?.trim() || null;

    const categoryId =
      body.categoryId?.trim() || null;

    const price = Number(body.price);

    const costPrice =
      body.costPrice === "" ||
      body.costPrice === null ||
      body.costPrice === undefined
        ? null
        : Number(body.costPrice);

    const isActive =
      typeof body.isActive === "boolean"
        ? body.isActive
        : true;

    if (body.isSellable !== undefined && typeof body.isSellable !== "boolean") {
      return NextResponse.json(
        { error: "POS satışa uygunluğu açık veya kapalı olmalıdır." },
        { status: 400 }
      );
    }

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!name) {
      return NextResponse.json(
        {
          error: "Ürün adı zorunludur.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(price) ||
      price < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Geçerli bir satış fiyatı giriniz.",
        },
        { status: 400 }
      );
    }

    if (
      costPrice !== null &&
      (!Number.isFinite(costPrice) ||
        costPrice < 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Geçerli bir maliyet fiyatı giriniz.",
        },
        { status: 400 }
      );
    }

    // ==================================================
    // CATEGORY TENANT CHECK
    // ==================================================

    if (categoryId) {
      const category =
        await prisma.category.findFirst({
          where: {
            id: categoryId,
            organizationId:
              membership.organizationId,
          },

          select: {
            id: true,
          },
        });

      if (!category) {
        return NextResponse.json(
          {
            error: "Kategori bulunamadı.",
          },
          { status: 404 }
        );
      }
    }

    // ==================================================
    // SKU DUPLICATE CHECK
    // ==================================================

    if (sku) {
      const existingSku =
        await prisma.product.findFirst({
          where: {
            organizationId:
              membership.organizationId,

            sku,

            NOT: {
              id: productId,
            },
          },

          select: {
            id: true,
          },
        });

      if (existingSku) {
        return NextResponse.json(
          {
            error:
              "Bu SKU kodu başka bir üründe kullanılıyor.",
          },
          { status: 409 }
        );
      }
    }

    // ==================================================
    // BARCODE DUPLICATE CHECK
    // ==================================================

    if (barcode) {
      const existingBarcode =
        await prisma.product.findFirst({
          where: {
            organizationId:
              membership.organizationId,

            barcode,

            NOT: {
              id: productId,
            },
          },

          select: {
            id: true,
          },
        });

      if (existingBarcode) {
        return NextResponse.json(
          {
            error:
              "Bu barkod başka bir üründe kullanılıyor.",
          },
          { status: 409 }
        );
      }
    }

    // ==================================================
    // UPDATE PRODUCT
    // ==================================================

    if (body.unit !== undefined && body.unit !== existingProduct.unit) {
      const used = await prisma.stockMovement.count({ where: { productId, organizationId: membership.organizationId } });
      const stocked = await prisma.branchStock.count({ where: { productId, organizationId: membership.organizationId, quantity: { not: 0 } } });
      const recipes = await prisma.recipeItem.count({ where: { OR: [{ ingredientId: productId }, { recipe: { productId } }] } });
      if (used || stocked || recipes) throw new CashError("Stok/reçete geçmişi olan ürünün birimi değiştirilemez. Yeni ürün tanımlayın.", 409);
    }
    const product = await prisma.$transaction(async tx => {
      const updated = await tx.product.update({
        where: {
          id: productId,
        },

        data: {
          name,
          description,
          sku,
          barcode,
          imageUrl,
          price,
          costPrice,
          categoryId,
          isActive,
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          // Older clients that omit this field must preserve its saved value.
          ...(body.isSellable !== undefined ? { isSellable: body.isSellable } : {}),
        },

        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

    await writeAudit(tx, membership, "product.update", "Product", updated.id);
    return updated;
    });
    return NextResponse.json({
      message:
        "Ürün başarıyla güncellendi.",
      product,
    });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(
      "UPDATE_PRODUCT_ERROR:",
      error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error:
          "Ürün güncellenirken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

// ======================================================
// DELETE /api/products/[id]
// Ürün sil
// ======================================================

async function handleDELETE(
  _request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const membership =
      await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const { id: productId } =
      await context.params;

    // ==================================================
    // PRODUCT TENANT CHECK
    // ==================================================

    const product =
      await prisma.product.findFirst({
        where: {
          id: productId,
          organizationId:
            membership.organizationId,
        },

        select: {
          id: true,
        },
      });

    if (!product) {
      return NextResponse.json(
        {
          error: "Ürün bulunamadı.",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // DELETE
    // ==================================================

    const archived = await prisma.$transaction(async tx => {
      const saved = await tx.product.update({ where: { id: productId, organizationId: membership.organizationId }, data: { isActive: false, isSellable: false } });
      await writeAudit(tx, membership, "product.archive", "Product", productId);
      return saved;
    });

    return NextResponse.json({
      message:
        "Ürün arşivlendi. Stok ve satış geçmişi korundu.",
      product: archived,
    });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(
      "DELETE_PRODUCT_ERROR:",
      error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error:
          "Ürün silinirken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

export const PATCH = withPermission("products.manage", handlePATCH);

export const DELETE = withPermission("products.manage", handleDELETE);
