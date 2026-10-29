import { withPermission } from "@/lib/rbac";
import { hasPermission } from "@/lib/permissions";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

// ======================================================
// GET /api/categories
// Kategorileri getir
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
      const categories = await prisma.category.findMany({ where: { organizationId: membership.organizationId, products: { some: { isActive: true, isSellable: true } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      return NextResponse.json({ categories });
    }
    const categories = await prisma.category.findMany({
      where: {
        organizationId: membership.organizationId,
      },

      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      categories,
    });
  } catch (error) {
    console.error("GET_CATEGORIES_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Kategoriler alınırken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/categories
// Yeni kategori oluştur
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

    const body = await request.json();

    const name = body.name?.trim();

    // ==================================================
    // VALIDATION
    // ==================================================

    if (!name) {
      return NextResponse.json(
        {
          error: "Kategori adı zorunludur.",
        },
        { status: 400 }
      );
    }

    // ==================================================
    // DUPLICATE CATEGORY CHECK
    // Aynı organizasyonda aynı isimli kategori olamaz.
    // Büyük/küçük harf farkı dikkate alınmaz.
    // ==================================================

    const existingCategory =
      await prisma.category.findFirst({
        where: {
          organizationId: membership.organizationId,

          name: {
            equals: name,
            mode: "insensitive",
          },
        },

        select: {
          id: true,
        },
      });

    if (existingCategory) {
      return NextResponse.json(
        {
          error:
            "Bu isimde bir kategori zaten mevcut.",
        },
        { status: 409 }
      );
    }

    // ==================================================
    // CREATE CATEGORY
    // ==================================================

    const category = await prisma.category.create({
      data: {
        name,

        organizationId:
          membership.organizationId,
      },

      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        message:
          "Kategori başarıyla oluşturuldu.",

        category,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_CATEGORY_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error:
          "Kategori oluşturulurken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}
export const GET = withPermission("catalog.read", handleGET);

export const POST = withPermission("products.manage", handlePOST);
