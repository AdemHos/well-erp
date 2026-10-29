import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import {
  Prisma,
  FinanceDirection,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ======================================================
// HELPERS
// ======================================================

function isDirection(
  value: unknown
): value is FinanceDirection {
  return (
    value === FinanceDirection.IN ||
    value === FinanceDirection.OUT
  );
}

// ======================================================
// GET /api/finance/categories
// List income and expense categories
// ======================================================

async function handleGET(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    const organizationId = membership.organizationId;
    const params = request.nextUrl.searchParams;

    const direction = params.get("direction");
    const activeParam = params.get("isActive");

    // Validate direction
    if (direction && !isDirection(direction)) {
      return NextResponse.json(
        { error: "Geçersiz kategori türü." },
        { status: 400 }
      );
    }

    // Validate active filter
    if (
      activeParam !== null &&
      activeParam !== "true" &&
      activeParam !== "false"
    ) {
      return NextResponse.json(
        { error: "Geçersiz aktiflik filtresi." },
        { status: 400 }
      );
    }

    const where: Prisma.FinanceCategoryWhereInput = {
      organizationId,
    };

    if (direction && isDirection(direction)) {
      where.direction = direction;
    }

    if (activeParam !== null) {
      where.isActive = activeParam === "true";
    }

    const categories = await prisma.financeCategory.findMany({
      where,
      include: {
        _count: {
          select: {
            transactions: { where: { organizationId, ...branchScope(membership) } },
          },
        },
      },
      orderBy: [
        { direction: "asc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json({
      success: true,
      categories: categories.map((category) => ({
        id: category.id,
        organizationId: category.organizationId,
        name: category.name,
        direction: category.direction,
        isActive: category.isActive,
        transactionCount: category._count.transactions,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Finance categories GET error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Finans kategorileri getirilemedi." },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/finance/categories
// Create income or expense category
// ======================================================

async function handlePOST(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    // Authorization
    

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Geçerli bir JSON gövdesi gönderin." },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Geçersiz istek verisi." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    const name =
      typeof data.name === "string"
        ? data.name.trim()
        : "";

    const direction = data.direction;

    // Validate category name
    if (!name || name.length > 100) {
      return NextResponse.json(
        {
          error:
            "Kategori adı 1-100 karakter arasında olmalıdır.",
        },
        { status: 400 }
      );
    }

    // Validate direction
    if (!isDirection(direction)) {
      return NextResponse.json(
        {
          error:
            "Kategori türü IN (gelir) veya OUT (gider) olmalıdır.",
        },
        { status: 400 }
      );
    }

    const organizationId = membership.organizationId;

    // Create category
    const category = await prisma.$transaction(async (tx) => { const entry = await tx.financeCategory.create({
      data: {
        organizationId,
        name,
        direction,
        isActive: true,
      },
    }); await writeAudit(tx, membership, "finance.category.create", "FinanceCategory", entry.id, undefined); return entry; });

    return NextResponse.json(
      {
        success: true,
        message: "Finans kategorisi oluşturuldu.",
        category,
      },
      { status: 201 }
    );
  } catch (error) {
    // Duplicate category
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "Bu isimde ve türde bir finans kategorisi zaten mevcut.",
        },
        { status: 409 }
      );
    }

    console.error("Finance categories POST error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Finans kategorisi oluşturulamadı." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("finance.manage", handleGET);

export const POST = withPermission("finance.manage", handlePOST);
