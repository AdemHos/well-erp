import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

async function handlePOST(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    

    

    const body = await request.json().catch(() => null);

    if (
      !body ||
      typeof body.tableId !== "string" ||
      !body.tableId.trim()
    ) {
      return NextResponse.json(
        { error: "Geçerli bir masa seçmelisiniz." },
        { status: 400 }
      );
    }

    const table = await prisma.restaurantTable.findFirst({
      where: { AND: [{
        id: body.tableId,
        organizationId: membership.organizationId,
        isActive: true,
      }, branchScope(membership)] },
      select: {
        id: true,
        name: true,
        branchId: true,
      },
    });

    if (!table) {
      return NextResponse.json(
        { error: "Masa bulunamadı veya kullanım dışı." },
        { status: 404 }
      );
    }

    // Aynı masaya eşzamanlı iki adisyon açılmasını
    // engellemek için işlemi transaction içinde yürütüyoruz.
    const tab = await prisma.$transaction(
      async (tx) => {
        // PostgreSQL satır kilidi:
        // Aynı masaya gelen işlemleri sıraya alır.
        await tx.$queryRaw`
          SELECT id
          FROM "RestaurantTable"
          WHERE id = ${table.id}
          FOR UPDATE
        `;

        const existingTab = await tx.tab.findFirst({
          where: { AND: [{
            tableId: table.id,
            status: "OPEN",
          }, branchScope(membership)] },
          select: {
            id: true,
          },
        });

        if (existingTab) {
          throw new Error("TABLE_ALREADY_OCCUPIED");
        }

        // Organizasyon bazında benzersiz adisyon numarası.
        const tabNumber = `AD-${crypto.randomUUID()}`;

        const created = await tx.tab.create({
          data: {
            tabNumber,
            organizationId: membership.organizationId,
            branchId: table.branchId,
            tableId: table.id,
            status: "OPEN",
            subtotal: new Prisma.Decimal(0),
            total: new Prisma.Decimal(0),
          },
          select: {
            id: true,
            tabNumber: true,
            status: true,
            tableId: true,
            branchId: true,
            openedAt: true,
          },
        });
        await writeAudit(tx, membership, "restaurant.tab.open", "Tab", created.id, table.branchId);
        return created;
      }
    );

    return NextResponse.json(
      {
        message: `${table.name} için adisyon açıldı.`,
        tab,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "TABLE_ALREADY_OCCUPIED"
    ) {
      return NextResponse.json(
        { error: "Bu masada zaten açık bir adisyon var." },
        { status: 409 }
      );
    }

    console.error("CREATE_TAB_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Adisyon açılırken bir hata oluştu." },
      { status: 500 }
    );
  }
}
    
export const POST = withPermission("restaurant.manage", handlePOST, "table");
