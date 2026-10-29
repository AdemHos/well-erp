import { writeAudit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma/client";
import { withPermission } from "@/lib/rbac";
import { branchIdScope } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ branchId: string }>;
};

async function handlePATCH(
  request: Request,
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

    

    const { branchId } = await params;

    const body = await request.json().catch(() => null);
    const name = body?.name;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return NextResponse.json(
        { error: "Şube adı 2-100 karakter olmalıdır." },
        { status: 400 }
      );
    }

    const normalizedName = name.trim();

    const branch = await prisma.branch.findFirst({
      where: { AND: [{
        id: branchId,
        organizationId: membership.organizationId,
      }, branchIdScope(membership)] },
    });

    if (!branch) {
      return NextResponse.json(
        { error: "Şube bulunamadı." },
        { status: 404 }
      );
    }

    const duplicate = await prisma.branch.findFirst({
      where: { AND: [{
        organizationId: membership.organizationId,
        id: { not: branchId },
        name: {
          equals: normalizedName,
          mode: "insensitive",
        },
      }, branchIdScope(membership)] },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "Bu isimde başka bir şube mevcut." },
        { status: 409 }
      );
    }

    const updatedBranch = await prisma.$transaction(async tx => {
    const updated = await tx.branch.update({
      where: { ...{
        id: branchId,
      }, AND: [branchIdScope(membership)] },
      data: {
        name: normalizedName,
      },
      select: {
        id: true,
        name: true,
      },
    });

    await writeAudit(tx, membership, "branch.update", "Branch", updated.id, updated.id);
    return updated;
    });
    return NextResponse.json({
      branch: updatedBranch,
      message: "Şube güncellendi.",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Bu isimde şube zaten mevcut." }, { status: 409 });
    console.error("BRANCH_UPDATE_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Şube güncellenemedi." },
      { status: 500 }
    );
  }
}

export const PATCH = withPermission("branches.manage", handlePATCH, "branch");
