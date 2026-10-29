import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { NextResponse } from "next/server";

import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";



type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// PATCH /api/categories/:id
async function handlePATCH(
  request: Request,
  context: RouteContext
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const body = await request.json();
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json(
        { error: "Kategori adı zorunludur." },
        { status: 400 }
      );
    }

    // Önce kategori gerçekten bu işletmeye mi ait kontrol ediyoruz.
    const category = await prisma.category.findFirst({
      where: {
        id,
        organizationId: membership.organizationId,
      },
    });

    if (!category) {
      return NextResponse.json(
        { error: "Kategori bulunamadı." },
        { status: 404 }
      );
    }

    const duplicateCategory = await prisma.category.findFirst({
      where: {
        organizationId: membership.organizationId,
        name: {
          equals: name,
          mode: "insensitive",
        },
        NOT: {
          id,
        },
      },
    });

    if (duplicateCategory) {
      return NextResponse.json(
        { error: "Bu kategori zaten mevcut." },
        { status: 409 }
      );
    }

    const updatedCategory = await prisma.category.update({
      where: {
        id,
      },
      data: {
        name,
      },
    });

    return NextResponse.json({
      message: "Kategori başarıyla güncellendi.",
      category: updatedCategory,
    });
  } catch (error) {
    console.error("UPDATE_CATEGORY_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Kategori güncellenirken bir hata oluştu." },
      { status: 500 }
    );
  }
}

// DELETE /api/categories/:id
async function handleDELETE(
  _request: Request,
  context: RouteContext
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const category = await prisma.category.findFirst({
      where: {
        id,
        organizationId: membership.organizationId,
      },
    });

    if (!category) {
      return NextResponse.json(
        { error: "Kategori bulunamadı." },
        { status: 404 }
      );
    }

    await prisma.$transaction(async tx => {
      await tx.product.updateMany({ where: { organizationId: membership.organizationId, categoryId: id }, data: { categoryId: null } });
      await tx.category.delete({ where: { id, organizationId: membership.organizationId } });
      await writeAudit(tx, membership, "category.delete", "Category", id);
    });

    return NextResponse.json({
      message: "Kategori başarıyla silindi.",
    });
  } catch (error) {
    console.error("DELETE_CATEGORY_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Kategori silinirken bir hata oluştu." },
      { status: 500 }
    );
  }
}
export const PATCH = withPermission("products.manage", handlePATCH);

export const DELETE = withPermission("products.manage", handleDELETE);
