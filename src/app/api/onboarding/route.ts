import { assertSameOrigin, boundedJson } from "@/lib/http-security";
import { AccessError } from "@/lib/auth-context";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const raw = await boundedJson(request, 4096);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AccessError("Geçersiz işletme bilgisi.", 400);
    const body = raw as { organizationName?: string; branchName?: string };
    if (typeof body.organizationName !== "string" || typeof body.branchName !== "string" || body.organizationName.length > 160 || body.branchName.length > 100) throw new AccessError("İşletme/şube adı geçersiz.", 400);

    const organizationName = body.organizationName?.trim();
    const branchName = body.branchName?.trim();

    if (!organizationName || !branchName) {
      return NextResponse.json(
        { error: "İşletme adı ve şube adı zorunludur." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        email: session.user.email,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Kullanıcı bulunamadı." },
        { status: 404 }
      );
    }

    // Kullanıcının zaten bir işletmesi var mı?
    const existingMembership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
      },
    });

    if (existingMembership) {
      return NextResponse.json(
        { error: "Zaten bir işletmeye bağlısınız." },
        { status: 409 }
      );
    }

    const slug = `${organizationName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}-${crypto.randomUUID().slice(0, 8)}`;

    const organization = await prisma.$transaction(async (tx) => {
      const newOrganization = await tx.organization.create({
        select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
        data: {
          name: organizationName,
          slug,
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: newOrganization.id,
          role: "OWNER",
        },
      });

      await tx.branch.create({
        data: {
          name: branchName,
          organizationId: newOrganization.id,
        },
      });

      return newOrganization;
    });

    return NextResponse.json(
      {
        message: "İşletme başarıyla oluşturuldu.",
        organization,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("ONBOARDING_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "İşletme oluşturulurken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}
