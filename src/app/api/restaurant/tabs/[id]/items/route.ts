import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};



async function handlePOST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // ============================================
    // 1. AUTHENTICATION
    // ============================================

    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    // ============================================
    // 2. AUTHORIZATION
    // ============================================

    

    // ============================================
    // 3. REQUEST VALIDATION
    // ============================================

    const { id: tabId } = await context.params;

    const body = await request.json().catch(() => null);

    const productId = body?.productId;
    const quantity = body?.quantity;

    if (
      !tabId ||
      typeof productId !== "string" ||
      !productId.trim()
    ) {
      return NextResponse.json(
        { error: "Geçerli bir adisyon ve ürün seçmelisiniz." },
        { status: 400 }
      );
    }

    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 999
    ) {
      return NextResponse.json(
        { error: "Ürün miktarı 1 ile 999 arasında olmalıdır." },
        { status: 400 }
      );
    }

    // ============================================
    // 4. DATABASE TRANSACTION
    // ============================================

    const result = await prisma.$transaction(
      async (tx) => {
        // Eşzamanlı isteklerde aynı adisyonun
        // toplamının yanlış hesaplanmasını önler.

        const lockedTabs = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM "Tab"
          WHERE id = ${tabId}
            AND "organizationId" = ${membership.organizationId}
          FOR UPDATE
        `;

        if (lockedTabs.length === 0) {
          throw new Error("TAB_NOT_FOUND");
        }

        // ========================================
        // 5. TAB VALIDATION
        // ========================================

        const tab = await tx.tab.findFirst({
          where: { AND: [{
            id: tabId,
            organizationId: membership.organizationId,
          }, branchScope(membership)] },
        });

        if (!tab) {
          throw new Error("TAB_NOT_FOUND");
        }

        if (tab.status !== "OPEN") {
          throw new Error("TAB_NOT_OPEN");
        }

        // ========================================
        // 6. PRODUCT VALIDATION
        // ========================================

        const product = await tx.product.findFirst({
          where: {
            id: productId,
            organizationId: membership.organizationId,
            isActive: true,
            isSellable: true,
          },
          select: {
            id: true,
            name: true,
            price: true,
          },
        });

        if (!product) {
          throw new Error("PRODUCT_NOT_FOUND");
        }

        // ========================================
        // 7. PRICE CALCULATION
        // ========================================

        const decimalQuantity = new Prisma.Decimal(
          quantity
        );

        const unitPrice = new Prisma.Decimal(
          product.price.toString()
        );

        const lineTotal = unitPrice.mul(
          decimalQuantity
        );

        // ========================================
        // 8. CREATE TAB ITEM
        // ========================================

        const item = await tx.tabItem.create({
          data: {
            tabId: tab.id,
            productId: product.id,
            productName: product.name,
            quantity: decimalQuantity,
            unitPrice,
            total: lineTotal,
          },
        });

        // ========================================
        // 9. RECALCULATE TAB TOTAL
        // ========================================

        const aggregate = await tx.tabItem.aggregate({
          where: {
            tabId: tab.id,
          },
          _sum: {
            total: true,
          },
        });

        const newTotal =
          aggregate._sum.total ??
          new Prisma.Decimal(0);

        // ========================================
        // 10. UPDATE TAB
        // ========================================

        const updatedTab = await tx.tab.update({
          where: { ...{
            id: tab.id,
          }, AND: [branchScope(membership)] },
          data: {
            subtotal: newTotal,
            total: newTotal,
          },
        });

        await writeAudit(tx, membership, "restaurant.item.add", "TabItem", item.id, tab.branchId);
        return {
          item: {
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            total: item.total.toString(),
          },
          tab: {
            id: updatedTab.id,
            tabNumber: updatedTab.tabNumber,
            subtotal: updatedTab.subtotal.toString(),
            total: updatedTab.total.toString(),
          },
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );

    // ============================================
    // 11. SUCCESS RESPONSE
    // ============================================

    return NextResponse.json(
      {
        success: true,
        message: "Ürün adisyona başarıyla eklendi.",
        ...result,
      },
      { status: 201 }
    );
  } catch (error) {
    // ============================================
    // 12. ERROR HANDLING
    // ============================================

    console.error("ADD_TAB_ITEM_ERROR:", error instanceof Error ? error.name : "UnknownError");

    if (error instanceof Error) {
      if (error.message === "TAB_NOT_FOUND") {
        return NextResponse.json(
          { error: "Adisyon bulunamadı." },
          { status: 404 }
        );
      }

      if (error.message === "TAB_NOT_OPEN") {
        return NextResponse.json(
          { error: "Bu adisyon açık değil." },
          { status: 409 }
        );
      }

      if (error.message === "PRODUCT_NOT_FOUND") {
        return NextResponse.json(
          { error: "Ürün bulunamadı, pasif veya satışa kapalı." },
          { status: 404 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "Ürün adisyona eklenirken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}

export const POST = withPermission("restaurant.manage", handlePOST, "tab");
