import { validateProductBody } from "@/lib/product-input";
import { CashError } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { hasPermission } from "@/lib/permissions";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

// ======================================================
// GET /api/products
// ======================================================

async function handleGET() {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    if (!hasPermission(membership.role, "products.manage")) {
      const products = await prisma.product.findMany({
        where: { organizationId: membership.organizationId, isActive: true, isSellable: true },
        select: { id: true, name: true, sku: true, barcode: true, imageUrl: true, price: true, isActive: true, isSellable: true, categoryId: true },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({ products });
    }
    const products = await prisma.product.findMany({
      where: {
        organizationId: membership.organizationId,
      },

      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      products,
    });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET_PRODUCTS_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Ürünler alınırken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/products
// Yeni ürün oluştur
// ======================================================

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    validateProductBody(body);

    const name = body.name?.trim();

    const description =
      body.description?.trim() || null;

    const sku = body.sku?.trim() || null;

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
    const isSellable = body.isSellable ?? true;

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

    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json(
        {
          error: "Geçerli bir satış fiyatı giriniz.",
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
          error: "Geçerli bir maliyet fiyatı giriniz.",
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
    // CREATE PRODUCT
    // ==================================================

    const product = await prisma.$transaction(async tx => {
    const created = await tx.product.create({
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
        isSellable,
        ...(body.unit !== undefined ? { unit: body.unit } : {}),

        organizationId:
          membership.organizationId,
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

    await writeAudit(tx, membership, "product.create", "Product", created.id);
    return created;
    });

    return NextResponse.json(
      {
        message: "Ürün başarıyla oluşturuldu.",
        product,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("CREATE_PRODUCT_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error:
          "Ürün oluşturulurken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

export const GET = withPermission("catalog.read", handleGET);

export const POST = withPermission("products.manage", handlePOST);
