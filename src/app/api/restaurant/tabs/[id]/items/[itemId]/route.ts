import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{
    id: string;
    itemId: string;
  }>;
};



class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function getAuthorizedMembership() {
  const membership = await getCurrentMembership();

  if (!membership) {
    throw new ApiError("Oturum açmanız gerekiyor.", 401);
  }

  

  return membership;
}

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  console.error("TAB_ITEM_MUTATION_ERROR:", error instanceof Error ? error.name : "UnknownError");

  return NextResponse.json(
    { error: "Adisyon ürünü güncellenirken hata oluştu." },
    { status: 500 }
  );
}

async function mutateTabItem(
  tabId: string,
  itemId: string,
  organizationId: string,
  operation: "UPDATE" | "DELETE",
  quantity?: number
) {
  return prisma.$transaction(async (tx) => {
    // Eşzamanlı adisyon işlemlerini sıraya al.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Tab"
      WHERE id = ${tabId}
        AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;

    if (locked.length === 0) {
      throw new ApiError("Adisyon bulunamadı.", 404);
    }

    const tab = await tx.tab.findFirst({
      where: {
        id: tabId,
        organizationId,
      },
    });

    if (!tab) {
      throw new ApiError("Adisyon bulunamadı.", 404);
    }

    if (tab.status !== "OPEN") {
      throw new ApiError(
        "Kapalı adisyonda değişiklik yapılamaz.",
        409
      );
    }

    const item = await tx.tabItem.findFirst({
      where: {
        id: itemId,
        tabId: tab.id,
      },
    });

    if (!item) {
      throw new ApiError(
        "Adisyondaki ürün bulunamadı.",
        404
      );
    }

    // ==================================================
    // KITCHEN SAFETY
    // ==================================================
    // Hazırlanmaya başlanmış, hazır veya servis edilmiş
    // ürünlerin miktarı değiştirilemez ve silinemez.

    if (item.kitchenStatus !== "PENDING") {
      const statusMessages = {
        PREPARING: "Ürün mutfakta hazırlanıyor.",
        READY: "Ürün hazırlandı.",
        SERVED: "Ürün servis edildi.",
      };

      const statusMessage =
        statusMessages[item.kitchenStatus];

      throw new ApiError(
        `${statusMessage} Bu nedenle ürün silinemez veya miktarı değiştirilemez.`,
        409
      );
    }

    // ==================================================
    // UPDATE / DELETE
    // ==================================================

    if (operation === "UPDATE") {
      const decimalQuantity = new Prisma.Decimal(quantity!);

      await tx.tabItem.update({
        where: { id: item.id },
        data: {
          quantity: decimalQuantity,
          total: item.unitPrice.mul(decimalQuantity),
        },
      });
    } else {
      await tx.tabItem.delete({
        where: { id: item.id },
      });
    }

    // Adisyonun toplamını yeniden hesapla.
    const aggregate = await tx.tabItem.aggregate({
      where: {
        tabId: tab.id,
      },
      _sum: {
        total: true,
      },
    });

    const newTotal =
      aggregate._sum.total ?? new Prisma.Decimal(0);

    await tx.tab.update({
      where: {
        id: tab.id,
      },
      data: {
        subtotal: newTotal,
        total: newTotal,
      },
    });

    const actor = (await getCurrentMembership({ required: true }))!;
    await writeAudit(tx, actor, operation === "DELETE" ? "restaurant.item.delete" : "restaurant.item.update", "TabItem", itemId, tab.branchId);
    return {
      total: newTotal.toString(),
    };
  });
}

// ======================================================
// PATCH - UPDATE ITEM QUANTITY
// ======================================================

async function handlePATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const membership = await getAuthorizedMembership();
    const { id, itemId } = await context.params;

    if (!id || !itemId) {
      throw new ApiError(
        "Geçersiz adisyon veya ürün ID.",
        400
      );
    }

    const body = await request.json().catch(() => null);
    const quantity = body?.quantity;

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 999
    ) {
      throw new ApiError(
        "Miktar 1 ile 999 arasında bir tam sayı olmalıdır.",
        400
      );
    }

    const result = await mutateTabItem(
      id,
      itemId,
      membership.organizationId,
      "UPDATE",
      quantity
    );

    return NextResponse.json({
      success: true,
      message: "Ürün miktarı güncellendi.",
      ...result,
    });
  } catch (error) {
    return handleError(error);
  }
}

// ======================================================
// DELETE - REMOVE ITEM
// ======================================================

async function handleDELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const membership = await getAuthorizedMembership();
    const { id, itemId } = await context.params;

    if (!id || !itemId) {
      throw new ApiError(
        "Geçersiz adisyon veya ürün ID.",
        400
      );
    }

    const result = await mutateTabItem(
      id,
      itemId,
      membership.organizationId,
      "DELETE"
    );

    return NextResponse.json({
      success: true,
      message: "Ürün adisyondan kaldırıldı.",
      ...result,
    });
  } catch (error) {
    return handleError(error);
  }
}

export const PATCH = withPermission("restaurant.manage", handlePATCH, "tabItem");

export const DELETE = withPermission("restaurant.manage", handleDELETE, "tabItem");
