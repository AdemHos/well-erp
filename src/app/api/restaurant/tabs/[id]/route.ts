import { withPermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { CashError } from "@/lib/cash-management";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// ======================================================
// GET /api/restaurant/tabs/[id]
// ======================================================

async function handleGET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    // 1. Oturum ve organizasyon kontrolü

    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    // 2. Adisyon ID

    const { id } = await context.params;

    if (!id?.trim()) {
      return NextResponse.json(
        { error: "Geçersiz adisyon ID." },
        { status: 400 }
      );
    }

    // 3. Adisyonu organizasyon kapsamında getir

    const tab = await prisma.tab.findFirst({
      where: { AND: [{
        id,
        organizationId: membership.organizationId,
      }, branchScope(membership)] },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            isActive: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                isActive: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!tab) {
      return NextResponse.json(
        { error: "Adisyon bulunamadı." },
        { status: 404 }
      );
    }

    // 4. Decimal değerleri JSON için dönüştür

    const result = {
      id: tab.id,
      tabNumber: tab.tabNumber,
      status: tab.status,
      note: tab.note,

      subtotal: tab.subtotal.toString(),
      total: tab.total.toString(),

      organizationId: tab.organizationId,
      branchId: tab.branchId,
      tableId: tab.tableId,
      orderId: tab.orderId,

      table: tab.table,
      branch: tab.branch,

      items: tab.items.map((item) => ({
        id: item.id,
        tabId: item.tabId,
        productId: item.productId,
        productName: item.productName,
        note: item.note,

        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString(),

        product: item.product,

        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),

      openedAt: tab.openedAt,
      closedAt: tab.closedAt,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt,
    };

    return NextResponse.json({
      tab: result,
    });
  } catch (error) {
    console.error("GET_TAB_DETAIL_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Adisyon detayları alınırken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

export const GET = withPermission("restaurant.read", handleGET, "tab");

export const PATCH = withPermission("restaurant.manage", async (request: NextRequest, context: RouteContext) => {
  try {
    const actor = (await getCurrentMembership({ required: true }))!;
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (body?.action !== "CANCEL_EMPTY") throw new CashError("Geçersiz adisyon işlemi.");
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tab" WHERE id=${id} AND "organizationId"=${actor.organizationId} FOR UPDATE`;
      const tab = await tx.tab.findFirst({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) }, include: { _count: { select: { items: true } } } });
      if (!tab) throw new CashError("Adisyon bulunamadı.", 404);
      if (tab.status === "CANCELLED") return;
      if (tab.status !== "OPEN" || tab.orderId || tab._count.items !== 0) throw new CashError("Yalnız boş ve ödenmemiş adisyon iptal edilebilir.", 409);
      await tx.tab.update({ where: { id: tab.id }, data: { status: "CANCELLED", closedAt: new Date() } });
      await writeAudit(tx, actor, "restaurant.tab.cancel", "Tab", tab.id, tab.branchId);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Adisyon iptal edilemedi." }, { status: 500 });
  }
}, "tab");
