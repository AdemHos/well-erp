import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchIdScope, hasAllBranches } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ======================================================
// GET /api/branches
// Organizasyona ait şubeleri listele
// ======================================================

async function handleGET() {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        {
          error: "Oturum açmanız gerekiyor.",
        },
        { status: 401 }
      );
    }

    const branches = await prisma.branch.findMany({
      where: { AND: [{
        organizationId: membership.organizationId,
      }, branchIdScope(membership)] },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
            restaurantTables: true,
          },
        },
      },
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
    });

    return NextResponse.json({
      branches,
    });
  } catch (error) {
    console.error("BRANCH_LIST_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Şubeler yüklenemedi.",
      },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/branches
// Yeni şube oluştur
// ======================================================

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        {
          error: "Oturum açmanız gerekiyor.",
        },
        { status: 401 }
      );
    }

    if (!hasAllBranches(membership)) return NextResponse.json({ error: "Yeni şube oluşturmak için tüm şubelere erişim yetkisi gerekir." }, { status: 403 });
    

    const body: unknown = await request
      .json()
      .catch(() => null);

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          error: "Geçerli bir JSON gövdesi gönderin.",
        },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    const name = data.name;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return NextResponse.json(
        {
          error: "Şube adı 2-100 karakter olmalıdır.",
        },
        { status: 400 }
      );
    }

    const normalizedName = name.trim();

    const existing = await prisma.branch.findFirst({
      where: { AND: [{
        organizationId: membership.organizationId,
        name: {
          equals: normalizedName,
          mode: "insensitive",
        },
      }, branchIdScope(membership)] },
      select: {
        id: true,
      },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: "Bu isimde bir şube zaten mevcut.",
        },
        { status: 409 }
      );
    }

    const branch = await prisma.$transaction(async tx => {
    const created = await tx.branch.create({
      data: {
        name: normalizedName,
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    await writeAudit(tx, membership, "branch.create", "Branch", created.id, created.id);
    return created;
    });
    return NextResponse.json(
      {
        branch,
        message: "Şube oluşturuldu.",
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "Bu isimde bir şube zaten mevcut.",
        },
        { status: 409 }
      );
    }

    console.error("BRANCH_CREATE_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Şube oluşturulamadı.",
      },
      { status: 500 }
    );
  }
}

export const GET = withPermission("context", handleGET);

export const POST = withPermission("branches.manage", handlePOST);
