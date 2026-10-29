import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccessError } from "@/lib/auth-context";
import { assertSameOrigin } from "@/lib/http-security";
import { acceptStaffInvitation } from "@/lib/staff-service";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await auth();
    if (!session?.user?.email) throw new AccessError("Davet edilen hesapla giriş yapmalısınız.", 401);
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } });
    if (!user) throw new AccessError("Kullanıcı bulunamadı.", 401);
    const body = await request.json().catch(() => null);
    if (typeof body?.token !== "string") throw new AccessError("Geçersiz davet bağlantısı.", 400);
    const result = await acceptStaffInvitation(body.token, user);
    const store = await cookies();
    store.set("wellpos-active-organization", result.organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2592000 });
    store.delete("wellpos-active-branch");
    return NextResponse.json({ message: "İşletme daveti kabul edildi." });
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Davet kabul edilemedi." }, { status: 500 });
  }
}
