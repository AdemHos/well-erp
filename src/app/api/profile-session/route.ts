import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getBaseMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { assertSameOrigin } from "@/lib/http-security";
import { PROFILE_COOKIE, clearProfileSession, ensureOwnProfile, profileAccess, profileInclude, selectProfile } from "@/lib/staff-profiles";

const fail = (error: unknown) => NextResponse.json({ error: error instanceof AccessError ? error.message : "Profil işlemi gerçekleştirilemedi." }, { status: error instanceof AccessError ? error.status : 500 });
export async function GET() {
  try {
    const base = (await getBaseMembership({ required: true }))!;
    const profiles = await prisma.staffProfile.findMany({ where: { organizationId: base.organizationId, isActive: true, OR: [{ membershipId: null }, { membershipId: base.id }] }, include: profileInclude, orderBy: { createdAt: "asc" }, take: 500 });
    const choices = profiles.filter((profile) => profileAccess(base, profile)).map((profile) => ({ id: profile.id, name: profile.name, role: profile.membership?.role ?? profile.role, needsSetup: !profile.pinHash, isOwn: profile.membershipId === base.id }));
    if (!profiles.some((p) => p.membershipId === base.id)) choices.unshift({ id: "self", name: base.user.name || "Hesap sahibi", role: base.role, needsSetup: true, isOwn: true });
    return NextResponse.json({ profiles: choices, organizationName: base.organization.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const base = (await getBaseMembership({ required: true }))!;
    // Expire the previous selection before validating a replacement.
    await clearProfileSession();
    const body = await request.json().catch(() => null);
    if (typeof body?.profileId !== "string") throw new AccessError("Profil seçin.", 400);
    const id = body.profileId === "self" ? (await ensureOwnProfile(base)).id : body.profileId;
    const token = await selectProfile(base, id, body.pin, body.password, body.resetOwnPin === true);
    (await cookies()).set(PROFILE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
    return NextResponse.json({ success: true });
  } catch (error) { return fail(error); }
}
export async function DELETE(request: Request) {
  try { assertSameOrigin(request); await getBaseMembership({ required: true }); await clearProfileSession(); return NextResponse.json({ success: true }); }
  catch (error) { return fail(error); }
}
