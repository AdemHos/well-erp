import { withPermission } from "@/lib/rbac";
import { branchScope, branchIdScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

async function handleGET(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    

    

    const branchId = request.nextUrl.searchParams.get("branchId");

    if (!branchId) {
      return NextResponse.json(
        { error: "Şube seçimi zorunludur." },
        { status: 400 }
      );
    }

    const branch = await prisma.branch.findFirst({
      where: { AND: [{
        id: branchId,
        organizationId: membership.organizationId,
      }, branchIdScope(membership)] },
      select: {
        id: true,
        name: true,
      },
    });

    if (!branch) {
      return NextResponse.json(
        { error: "Şube bulunamadı." },
        { status: 404 }
      );
    }

    const tabs = await prisma.tab.findMany({
      where: { AND: [{
        organizationId: membership.organizationId,
        branchId,
        OR: [{ status: "OPEN" }, { status: "CLOSED", order: { status: "COMPLETED" } }],
        items: { some: { OR: [
          { kitchenStatus: { not: "SERVED" } },
          { kitchenStatus: "SERVED", kitchenServedAt: { gte: new Date(Date.now() - 86400000) } },
        ] } },
      }, branchScope(membership)] },
      select: {
        id: true,
        tabNumber: true,
        openedAt: true,
        table: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            note: true,
            kitchenStatus: true,
            kitchenStartedAt: true,
            kitchenReadyAt: true,
            kitchenServedAt: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        openedAt: "asc",
      },
    });

    const stats = {
      pending: 0,
      preparing: 0,
      ready: 0,
      served: 0,
    };

    const orders = tabs.map((tab) => {
      const items = tab.items.map((item) => {
        switch (item.kitchenStatus) {
          case "PENDING":
            stats.pending++;
            break;
          case "PREPARING":
            stats.preparing++;
            break;
          case "READY":
            stats.ready++;
            break;
          case "SERVED":
            stats.served++;
            break;
        }

        return {
          ...item,
          quantity: item.quantity.toString(),
        };
      });

      return {
        id: tab.id,
        tabNumber: tab.tabNumber,
        openedAt: tab.openedAt,
        table: tab.table,
        items,
      };
    });

    return NextResponse.json({
      success: true,
      branch,
      orders,
      stats,
      totalOrders: orders.length,
      totalItems: orders.reduce(
        (total, order) => total + order.items.length,
        0
      ),
    });
  } catch (error) {
    console.error("KITCHEN_GET_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Mutfak siparişleri yüklenemedi." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("kitchen.read", handleGET);
