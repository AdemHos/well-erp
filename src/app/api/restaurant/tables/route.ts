import { withPermission } from "@/lib/rbac";
import { branchScope, branchIdScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

// GET /api/restaurant/tables
// GET /api/restaurant/tables?branchId=xxx

async function handleGET(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const branchId = request.nextUrl.searchParams.get("branchId");

    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { AND: [{
          id: branchId,
          organizationId: membership.organizationId,
        }, branchIdScope(membership)] },
        select: { id: true },
      });

      if (!branch) {
        return NextResponse.json(
          { error: "Şube bulunamadı." },
          { status: 404 }
        );
      }
    }

    const tables = await prisma.restaurantTable.findMany({
      where: { AND: [{
        organizationId: membership.organizationId,
        ...(branchId ? { branchId } : {}),
      }, branchScope(membership)] },
      select: {
        id: true, name: true, capacity: true, isActive: true,
        organizationId: true, branchId: true, createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        tabs: {
          where: {
            status: "OPEN",
          },
          select: {
            id: true,
            tabNumber: true,
            total: true,
            openedAt: true,
          },
          take: 1,
        },
      },
      orderBy: [
        { branchId: "asc" },
        { name: "asc" },
      ],
    });

    const result = tables.map((table) => ({
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      isActive: table.isActive,
      organizationId: table.organizationId,
      branchId: table.branchId,
      branch: table.branch,
      status: table.tabs.length > 0 ? "OCCUPIED" : "EMPTY",
      activeTab: table.tabs[0]
        ? {
            id: table.tabs[0].id,
            tabNumber: table.tabs[0].tabNumber,
            total: table.tabs[0].total.toString(),
            openedAt: table.tabs[0].openedAt,
          }
        : null,
      createdAt: table.createdAt,
    }));

    return NextResponse.json({
      tables: result,
    });
  } catch (error) {
    console.error("GET_RESTAURANT_TABLES_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Masalar alınırken bir hata oluştu." },
      { status: 500 }
    );
  }
}

// POST /api/restaurant/tables

async function handlePOST(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    

    

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Geçersiz istek verisi." },
        { status: 400 }
      );
    }

    const { name, branchId, capacity } = body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100
    ) {
      return NextResponse.json(
        { error: "Masa adı 1-100 karakter olmalıdır." },
        { status: 400 }
      );
    }

    if (typeof branchId !== "string" || !branchId.trim()) {
      return NextResponse.json(
        { error: "Şube seçimi zorunludur." },
        { status: 400 }
      );
    }

    const parsedCapacity = capacity === undefined ? 4 : capacity;

    if (
      typeof parsedCapacity !== "number" ||
      !Number.isInteger(parsedCapacity) ||
      parsedCapacity < 1 ||
      parsedCapacity > 50
    ) {
      return NextResponse.json(
        { error: "Masa kapasitesi 1-50 arasında olmalıdır." },
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
      },
    });

    if (!branch) {
      return NextResponse.json(
        { error: "Seçilen şube bulunamadı." },
        { status: 404 }
      );
    }

    const normalizedName = name.trim();

    const existingTable = await prisma.restaurantTable.findFirst({
      where: { AND: [{
        branchId,
        name: {
          equals: normalizedName,
          mode: "insensitive",
        },
      }, branchScope(membership)] },
      select: {
        id: true,
      },
    });

    if (existingTable) {
      return NextResponse.json(
        { error: "Bu şubede aynı isimde bir masa zaten var." },
        { status: 409 }
      );
    }

    const table = await prisma.restaurantTable.create({
      data: {
        name: normalizedName,
        capacity: parsedCapacity,
        organizationId: membership.organizationId,
        branchId,
      },
      select: {
        id: true, name: true, capacity: true, isActive: true,
        organizationId: true, branchId: true, createdAt: true, updatedAt: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Masa başarıyla oluşturuldu.",
        table: {
          ...table,
          status: "EMPTY",
          activeTab: null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_RESTAURANT_TABLE_ERROR:", error instanceof Error ? error.name : "UnknownError");

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Bu şubede aynı isimde bir masa zaten var." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Masa oluşturulurken bir hata oluştu." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("restaurant.read", handleGET);

export const POST = withPermission("tables.manage", handlePOST);
