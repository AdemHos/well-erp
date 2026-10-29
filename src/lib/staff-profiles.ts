import { createHash, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { AccessError, type ActiveMembership } from "@/lib/auth-context";
import { allowedBranchIds, hasAllBranches, hasPermission, rolePermissions, canAssignRole } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const PROFILE_COOKIE = "wellpos-staff-session";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Tx = Prisma.TransactionClient;
export const profileInclude = { branchAccess: true, membership: { include: { branchAccess: { where: { isActive: true } } } } } as const;
type Profile = Prisma.StaffProfileGetPayload<{ include: typeof profileInclude }>;

export function profileAccess(base: ActiveMembership, profile: Profile): ActiveMembership | null {
  if (!profile.isActive || profile.organizationId !== base.organizationId) return null;
  const linked = profile.membership;
  if (profile.membershipId && (!linked || !linked.isActive || linked.userId !== base.userId)) return null;
  const role = linked?.role ?? profile.role;
  const allBranches = linked?.allBranches ?? profile.allBranches;
  const branchAccess = linked?.branchAccess ?? profile.branchAccess;
  // A shared profile cannot extend the authenticated account's own authority.
  if (!Object.hasOwn(rolePermissions, role) || rolePermissions[role].some((permission) => !hasPermission(base.role, permission))) return null;
  const access = { role, organizationId: base.organizationId, allBranches, branchAccess };
  if (!hasAllBranches(base) && (hasAllBranches(access) || allowedBranchIds(access).some((id) => !allowedBranchIds(base).includes(id)))) return null;
  return { ...base, role, allBranches, branchAccess, profileId: profile.id, user: { ...base.user, name: profile.name, image: linked ? base.user.image : null } };
}

export async function deviceIdentity() {
  const session = await auth() as (Session & { deviceSessionId?: string; authenticatedAt?: number }) | null;
  if (!session?.deviceSessionId) throw new AccessError("Profil güvenliği için çıkış yapıp tekrar giriş yapın.", 401);
  return { deviceSessionHash: digest(session.deviceSessionId), authenticatedAt: session.authenticatedAt ?? 0 };
}

export async function resolveProfile(base: ActiveMembership): Promise<ActiveMembership> {
  const raw = (await cookies()).get(PROFILE_COOKIE)?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AccessError("Devam etmek için personel profilinizi seçin.", 428);
  const device = await deviceIdentity();
  const record = await prisma.staffProfileSession.findFirst({ where: { tokenHash: digest(raw), userId: base.userId, organizationId: base.organizationId,
    deviceSessionHash: device.deviceSessionHash, expiresAt: { gt: new Date() } }, include: { profile: { include: profileInclude } } });
  const effective = record ? profileAccess(base, record.profile) : null;
  if (!record || !effective || record.credentialVersion !== record.profile.credentialVersion) throw new AccessError("Personel oturumu sona erdi. Profilinizi tekrar seçin.", 428);
  return { ...effective, profileSessionId: record.id };
}

// Recheck both layers inside sensitive transactions; never fall back to OWNER.
export async function freshProfileActor(tx: Tx, identity: ActiveMembership): Promise<ActiveMembership> {
  const member = await tx.membership.findFirst({ where: { userId: identity.userId, organizationId: identity.organizationId, isActive: true }, include: { branchAccess: { where: { isActive: true } } } });
  if (!member) throw new AccessError("Üyelik erişiminiz kaldırılmış.", 403);
  const base = { ...identity, ...member, profileId: undefined, profileSessionId: undefined };
  if (!identity.profileId) return base; // Server-only legacy invitation acceptance identity.
  const record = await tx.staffProfileSession.findFirst({ where: { id: identity.profileSessionId ?? "", userId: identity.userId, organizationId: identity.organizationId, profileId: identity.profileId, expiresAt: { gt: new Date() } }, include: { profile: { include: profileInclude } } });
  const actor = record && record.credentialVersion === record.profile.credentialVersion ? profileAccess(base, record.profile) : null;
  if (!actor) throw new AccessError("Güncel personel erişiminiz yok.", 403);
  return { ...actor, profileSessionId: record!.id };
}

export async function ensureOwnProfile(base: ActiveMembership) {
  return prisma.staffProfile.upsert({ where: { membershipId: base.id }, create: { organizationId: base.organizationId, membershipId: base.id, name: base.user.name || "Hesap sahibi", role: base.role, allBranches: base.allBranches }, update: {}, select: { id: true } });
}

export function canSetupWithGoogle(authenticatedAt: number, updatedAt: Date, reset: boolean, now = Date.now()) {
  return authenticatedAt <= now && now - authenticatedAt < 300000 && (!reset || authenticatedAt > updatedAt.getTime());
}

export async function selectProfile(base: ActiveMembership, id: string, pin: unknown, setupPassword: unknown, resetOwnPin = false) {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) throw new AccessError("6 haneli PIN girin.", 400);
  const device = await deviceIdentity();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StaffProfile" WHERE id = ${id} AND "organizationId" = ${base.organizationId} FOR UPDATE`;
    const profile = await tx.staffProfile.findFirst({ where: { id, organizationId: base.organizationId }, include: profileInclude });
    if (!profile || !profileAccess(base, profile)) return { error: "Profil bulunamadı veya erişiminiz yok.", status: 403 };
    if (profile.lockedUntil && profile.lockedUntil > new Date()) return { error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin.", status: 429 };
    if (!profile.pinHash || resetOwnPin) {
      if (profile.membershipId !== base.id) return { error: "Profil PIN'i henüz kurulmamış.", status: 403 };
      const user = await tx.user.findUniqueOrThrow({ where: { id: base.userId }, select: { password: true } });
      const verified = user.password ? typeof setupPassword === "string" && setupPassword.length <= 256 && await bcrypt.compare(setupPassword, user.password) : canSetupWithGoogle(device.authenticatedAt, profile.updatedAt, resetOwnPin);
      if (!verified) {
        await tx.staffProfile.update({ where: { id }, data: { failedAttempts: { increment: 1 }, lockedUntil: profile.failedAttempts >= 4 ? new Date(Date.now() + 900000) : null } });
        return { error: user.password ? "Hesap şifrenizi doğrulayın." : "PIN kurulumu için Google hesabınızla yeniden giriş yapın (5 dakika).", status: 403 };
      }
      await tx.staffProfile.update({ where: { id }, data: { pinHash: await bcrypt.hash(pin, 12), credentialVersion: { increment: 1 } } });
      await writeAudit(tx, { ...base, profileId: id }, "staff.profile.pin.setup", "StaffProfile", id);
    } else if (!(await bcrypt.compare(pin, profile.pinHash))) {
      await tx.staffProfile.update({ where: { id }, data: { failedAttempts: { increment: 1 }, lockedUntil: profile.failedAttempts >= 4 ? new Date(Date.now() + 900000) : null } });
      return { error: "PIN hatalı.", status: 403 };
    }
    const token = randomBytes(32).toString("base64url");
    await tx.staffProfile.update({ where: { id }, data: { failedAttempts: 0, lockedUntil: null } });
    // One active selection per browser login, including concurrent requests.
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${base.id} FOR UPDATE`;
    await tx.staffProfileSession.updateMany({ where: { userId: base.userId, deviceSessionHash: device.deviceSessionHash }, data: { expiresAt: new Date(0) } });
    await tx.staffProfileSession.create({ data: { tokenHash: digest(token), userId: base.userId, organizationId: base.organizationId, profileId: id, deviceSessionHash: device.deviceSessionHash, credentialVersion: profile.credentialVersion + ((!profile.pinHash || resetOwnPin) ? 1 : 0), expiresAt: new Date(Date.now() + 8 * 3600000) } });
    await writeAudit(tx, { ...base, profileId: id }, "staff.profile.select", "StaffProfile", id);
    return { token };
  }, { timeout: 15000 });
  if ("error" in result) throw new AccessError(result.error!, result.status!);
  return result.token;
}

export async function clearProfileSession() {
  const store = await cookies(); const raw = store.get(PROFILE_COOKIE)?.value;
  if (raw) await prisma.staffProfileSession.updateMany({ where: { tokenHash: digest(raw) }, data: { expiresAt: new Date(0) } });
  store.delete(PROFILE_COOKIE); store.delete("wellpos-active-branch");
}

export async function saveLocalProfile(identity: ActiveMembership, id: string | null, body: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${identity.organizationId} FOR UPDATE`;
    const actor = await freshProfileActor(tx, identity);
    if (!hasPermission(actor.role, "staff.manage")) throw new AccessError("Personel yönetimi yetkiniz yok.", 403);
    const target = id ? await tx.staffProfile.findFirst({ where: { id, organizationId: actor.organizationId }, include: profileInclude }) : null;
    if (id && !target) throw new AccessError("Personel bulunamadı.", 404);
    if (target?.membershipId) throw new AccessError("Gerçek hesap üyeliğini mevcut üyelik yönetiminden düzenleyin.", 400);
    if (target && (!canAssignRole(actor.role, target.role) || (!hasAllBranches(actor) && (target.allBranches || target.branchAccess.some((a) => !allowedBranchIds(actor).includes(a.branchId)))))) throw new AccessError("Bu personeli yönetemezsiniz.", 403);
    const name = typeof body.name === "string" ? body.name.trim() : target?.name;
    const role = body.role ?? target?.role;
    const branchId = body.branchId ?? target?.branchAccess[0]?.branchId;
    if (!name || name.length > 100 || typeof role !== "string" || !Object.hasOwn(rolePermissions, role) || role === "OWNER" || !canAssignRole(actor.role, role)) throw new AccessError("Geçerli ad soyad ve atanabilir rol seçin.", 400);
    if (typeof branchId !== "string" || !(await tx.branch.findFirst({ where: { id: branchId, organizationId: actor.organizationId, ...(!hasAllBranches(actor) ? { id: { in: allowedBranchIds(actor).filter((a) => a === branchId) } } : {}) } }))) throw new AccessError("Yetkili bir şube seçin.", 403);
    const isActive = body.isActive ?? target?.isActive ?? true;
    if (typeof isActive !== "boolean" || (body.resetPin !== undefined && typeof body.resetPin !== "boolean")) throw new AccessError("Geçersiz personel durumu.", 400);
    const pin = !target || body.resetPin === true ? String(randomInt(0, 1000000)).padStart(6, "0") : undefined;
    const data = { name, role: role as Profile["role"], isActive, allBranches: false, ...(pin ? { pinHash: await bcrypt.hash(pin, 12), failedAttempts: 0, lockedUntil: null } : {}) };
    const profile = target ? await tx.staffProfile.update({ where: { id: target.id }, data: { ...data, credentialVersion: { increment: 1 } } }) : await tx.staffProfile.create({ data: { ...data, organizationId: actor.organizationId } });
    await tx.staffProfileBranch.deleteMany({ where: { profileId: profile.id } });
    await tx.staffProfileBranch.create({ data: { profileId: profile.id, organizationId: actor.organizationId, branchId } });
    await writeAudit(tx, actor, target ? "staff.profile.change" : "staff.profile.create", "StaffProfile", profile.id, branchId, { name, role, isActive, pinReset: !!pin });
    return { id: profile.id, pin };
  }, { timeout: 15000 });
}
