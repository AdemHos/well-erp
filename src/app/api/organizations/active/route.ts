import { clearProfileSession } from "@/lib/staff-profiles";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccessError } from "@/lib/auth-context";
import { assertSameOrigin } from "@/lib/http-security";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await auth();
    if (!session?.user?.email) throw new AccessError("Oturum açmanız gerekiyor.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.organizationId !== "string") throw new AccessError("İşletme seçimi geçersiz.", 400);
    const member = await prisma.membership.findFirst({ where: { organizationId: body.organizationId, isActive: true, user: { email: session.user.email } }, select: { organizationId: true } });
    if (!member) throw new AccessError("Bu işletmeye erişim yetkiniz yok.", 403);
    await clearProfileSession();
    const store = await cookies();
    store.set("wellpos-active-organization", member.organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2592000 });
    store.delete("wellpos-active-branch");
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "İşletme değiştirilemedi." }, { status: 500 });
  }
}
