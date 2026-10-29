import { withPermission } from "@/lib/rbac";
import { branchIdScope } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const branchId = body?.branchId;

    if (
      typeof branchId !== "string" ||
      !branchId.trim()
    ) {
      return NextResponse.json(
        { error: "Geçerli bir şube seçmelisiniz." },
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
        { error: "Şube bulunamadı veya erişim yetkiniz yok." },
        { status: 404 }
      );
    }

    const cookieStore = await cookies();

    cookieStore.set("wellpos-active-branch", branch.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return NextResponse.json({
      success: true,
      message: "Aktif şube değiştirildi.",
      branch,
    });
  } catch (error) {
    console.error("ACTIVE_BRANCH_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Şube değiştirilirken hata oluştu." },
      { status: 500 }
    );
  }
}

export const POST = withPermission("context", handlePOST);
