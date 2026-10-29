import { writeAudit } from "@/lib/audit";
import { branchScope } from "@/lib/permissions";
import { withPermission } from "@/lib/rbac";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

type KitchenStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "SERVED";

const nextStatus: Record<
  KitchenStatus,
  KitchenStatus | null
> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
  SERVED: null,
};

async function handlePATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    

    

    const { itemId } = await params;

    const body = await request.json().catch(() => null);
    const status: unknown = body?.status;

    if (
      status !== "PREPARING" &&
      status !== "READY" &&
      status !== "SERVED"
    ) {
      return NextResponse.json(
        { error: "Geçersiz mutfak durumu." },
        { status: 400 }
      );
    }

    const item = await prisma.tabItem.findFirst({
      where: {
        id: itemId,
        tab: {
          organizationId: membership.organizationId,
          OR: [{ status: "OPEN" }, { status: "CLOSED", order: { status: "COMPLETED" } }],
          ...branchScope(membership),
        },
      },
      select: {
        id: true,
        kitchenStatus: true,
      },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Açık adisyonda ürün bulunamadı." },
        { status: 404 }
      );
    }

    const currentStatus = item.kitchenStatus as KitchenStatus;

    if (nextStatus[currentStatus] !== status) {
      return NextResponse.json(
        {
          error:
            "Geçersiz durum geçişi. " +
            `Mevcut durum: ${currentStatus}`,
        },
        { status: 409 }
      );
    }

    const now = new Date();

    const timestampUpdate =
      status === "PREPARING"
        ? { kitchenStartedAt: now }
        : status === "READY"
          ? { kitchenReadyAt: now }
          : { kitchenServedAt: now };

    // Durum değişimini atomik yap.
    // Adisyonun eşzamanlı kapatılması da engellenir.
    const result = await prisma.$transaction(async (tx) => {
      const lockedTabs = await tx.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT t.id
        FROM "Tab" t
        INNER JOIN "TabItem" i ON i."tabId" = t.id
        WHERE i.id = ${itemId}
          AND t."organizationId" = ${membership.organizationId}
          AND (t.status = 'OPEN'::"TabStatus" OR (t.status = 'CLOSED'::"TabStatus" AND EXISTS (SELECT 1 FROM "Order" o WHERE o.id=t."orderId" AND o.status='COMPLETED'))) 
        FOR UPDATE OF t
      `;

      if (lockedTabs.length === 0) {
        return null;
      }

      const updated = await tx.tabItem.updateMany({
        where: {
          id: itemId,
          kitchenStatus: currentStatus,
          tab: {
            organizationId: membership.organizationId,
            OR: [{ status: "OPEN" }, { status: "CLOSED", order: { status: "COMPLETED" } }],
          ...branchScope(membership),
          },
        },
        data: {
          kitchenStatus: status,
          ...timestampUpdate,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      await writeAudit(tx, membership, "restaurant.kitchen.status", "TabItem", itemId, undefined, { status });
      return tx.tabItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          productName: true,
          kitchenStatus: true,
          kitchenStartedAt: true,
          kitchenReadyAt: true,
          kitchenServedAt: true,
        },
      });
    });

    if (!result) {
      return NextResponse.json(
        {
          error:
            "Sipariş durumu değişmiş veya adisyon kapatılmış. " +
            "Listeyi yenileyin.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Mutfak durumu güncellendi.",
      item: result,
    });
  } catch (error) {
    console.error("KITCHEN_PATCH_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Mutfak durumu güncellenemedi." },
      { status: 500 }
    );
  }
}

export const PATCH = withPermission("kitchen.manage", handlePATCH, "tabItem");
