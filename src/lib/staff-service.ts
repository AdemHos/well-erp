import { freshProfileActor } from "@/lib/staff-profiles";
import { randomBytes, createHash } from "node:crypto";
import { Prisma, type Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessError, type ActiveMembership } from "@/lib/auth-context";
import { allowedBranchIds, branchIdScope, canAssignRole, hasAllBranches, hasPermission, rolePermissions } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

type Tx = Prisma.TransactionClient;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function lockStaffOrganization(tx: Tx, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
}
async function manager(tx: Tx, identity: { userId: string; organizationId: string; profileId?: string; profileSessionId?: string }) {
  const underlying = await tx.membership.findFirst({ where: { userId: identity.userId, organizationId: identity.organizationId, isActive: true }, include: { branchAccess: { where: { isActive: true } } } });
  const actor = underlying ? (identity.profileId ? await freshProfileActor(tx, { ...underlying, ...identity, user: { id: identity.userId, email: "", name: null, image: null }, organization: { id: identity.organizationId, name: "" } }) : underlying) : null;
  if (!actor || !hasPermission(actor.role, "staff.manage")) throw new AccessError("Güncel personel yönetimi yetkiniz yok.", 403);
  return actor;
}
function roleValue(value: unknown): Role {
  if (typeof value !== "string" || !Object.hasOwn(rolePermissions, value)) throw new AccessError("Geçerli bir rol seçin.", 400);
  return value as Role;
}
async function scope(tx: Tx, actor: Awaited<ReturnType<typeof manager>>, all: unknown, ids: unknown, role: Role) {
  if (typeof all !== "boolean" || !Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string" || !id)) throw new AccessError("Şube ataması geçersiz.", 400);
  const allBranches = role === "OWNER" || all;
  if (allBranches && !hasAllBranches(actor)) throw new AccessError("Tüm şubelere erişim atayamazsınız.", 403);
  const branchIds = allBranches ? [] : [...new Set(ids as string[])];
  if (!allBranches && !branchIds.length && role !== "STAFF") throw new AccessError("En az bir şube seçin.", 400);
  const count = await tx.branch.count({ where: { AND: [{ organizationId: actor.organizationId, id: { in: branchIds } }, branchIdScope(actor)] } });
  if (count !== branchIds.length) throw new AccessError("Atanan şubeler işletmenize veya erişim kapsamınıza uygun değil.", 403);
  return { allBranches, branchIds };
}
async function assignBranches(tx: Tx, membershipId: string, organizationId: string, branchIds: string[]) {
  await tx.membershipBranch.updateMany({ where: { membershipId, organizationId }, data: { isActive: false } });
  for (const branchId of branchIds) await tx.membershipBranch.upsert({ where: { membershipId_branchId: { membershipId, branchId } },
    create: { membershipId, branchId, organizationId }, update: { isActive: true } });
}
export async function changeStaff(identity: ActiveMembership, id: string, body: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    await lockStaffOrganization(tx, identity.organizationId);
    const actor = await manager(tx, identity);
    const target = await tx.membership.findFirst({ where: { id, organizationId: actor.organizationId }, include: { branchAccess: { where: { isActive: true } } } });
    if (!target) throw new AccessError("Personel üyeliği bulunamadı.", 404);
    if (!hasAllBranches(actor) && (target.allBranches || target.branchAccess.some((entry) => !allowedBranchIds(actor).includes(entry.branchId)))) {
      throw new AccessError("Bu üyeliğin şube kapsamı yönetim yetkinizin dışında.", 403);
    }
    const role = roleValue(body.role ?? target.role);
    if (!canAssignRole(actor.role, target.role) || !canAssignRole(actor.role, role)) throw new AccessError("Bu üyeliğin rolünü veya erişimini değiştiremezsiniz.", 403);
    const isActive = body.isActive ?? target.isActive;
    if (typeof isActive !== "boolean") throw new AccessError("Üyelik durumu geçersiz.", 400);
    const access = await scope(tx, actor, body.allBranches ?? target.allBranches, body.branchIds ?? target.branchAccess.map((entry) => entry.branchId), role);
    if (target.role === "OWNER" && target.isActive && (role !== "OWNER" || !isActive)) {
      const owners = await tx.membership.count({ where: { organizationId: actor.organizationId, role: "OWNER", isActive: true } });
      if (owners <= 1) throw new AccessError("İşletmenin son aktif OWNER üyesi kaldırılamaz veya rolü düşürülemez.", 409);
    }
    const result = await tx.membership.update({ where: { id: target.id }, data: { role, isActive, allBranches: access.allBranches } });
    await assignBranches(tx, result.id, result.organizationId, access.branchIds);
    await writeAudit(tx, actor, "staff.membership.change", "Membership", result.id, undefined, {
      before: { role: target.role, isActive: target.isActive, allBranches: target.allBranches, branchIds: target.branchAccess.map((entry) => entry.branchId) },
      after: { role, isActive, ...access },
    });
    return { id: result.id, role: result.role, isActive: result.isActive };
  }, { maxWait: 5000, timeout: 15000 });
}
export async function inviteStaff(identity: ActiveMembership, body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError("Geçerli bir e-posta adresi girin.", 400);
  const token = randomBytes(32).toString("base64url");
  const result = await prisma.$transaction(async (tx) => {
    await lockStaffOrganization(tx, identity.organizationId);
    const actor = await manager(tx, identity);
    const role = roleValue(body.role);
    if (!canAssignRole(actor.role, role)) throw new AccessError("Bu rol için davet oluşturamazsınız.", 403);
    const access = await scope(tx, actor, body.allBranches ?? false, body.branchIds ?? [], role);
    const existing = await tx.membership.findFirst({ where: { organizationId: actor.organizationId, isActive: true, user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } });
    if (existing) throw new AccessError("Bu kişi işletmenin aktif üyesi. Rolünü personel listesinden düzenleyin.", 409);
    const invitation = await tx.staffInvitation.create({ data: {
      organizationId: actor.organizationId, email, role, allBranches: access.allBranches, tokenHash: hash(token),
      createdById: actor.userId, expiresAt: new Date(Date.now() + 72 * 3600000),
      branches: { create: access.branchIds.map((branchId) => ({ branchId })) },
    } });
    await writeAudit(tx, actor, "staff.invitation.create", "StaffInvitation", invitation.id, undefined, { role, ...access });
    return { id: invitation.id, expiresAt: invitation.expiresAt };
  }, { maxWait: 5000, timeout: 15000 });
  return { ...result, path: `/invite#token=${token}` };
}
export async function revokeStaffInvitation(identity: ActiveMembership, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockStaffOrganization(tx, identity.organizationId);
    const actor = await manager(tx, identity);
    const invitation = await tx.staffInvitation.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!invitation) throw new AccessError("Davet bulunamadı.", 404);
    if (!canAssignRole(actor.role, invitation.role)) throw new AccessError("Bu daveti iptal edemezsiniz.", 403);
    const updated = await tx.staffInvitation.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (updated.count !== 1) throw new AccessError("Davet zaten kullanılmış veya iptal edilmiş.", 409);
    await writeAudit(tx, actor, "staff.invitation.revoke", "StaffInvitation", id);
  });
}
export async function acceptStaffInvitation(token: string, user: { id: string; email: string }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccessError("Davet bağlantısı geçersiz.", 400);
  return prisma.$transaction(async (tx) => {
    const initial = await tx.staffInvitation.findUnique({ where: { tokenHash: hash(token) }, select: { organizationId: true } });
    if (!initial) throw new AccessError("Davet geçersiz veya kullanılamıyor.", 404);
    await lockStaffOrganization(tx, initial.organizationId);
    const invitation = await tx.staffInvitation.findUniqueOrThrow({ where: { tokenHash: hash(token) }, include: { branches: true } });
    if (invitation.email !== user.email.trim().toLowerCase()) throw new AccessError("Davet edilen e-posta hesabıyla giriş yapmalısınız.", 403);
    const claimed = await tx.staffInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw new AccessError("Davet süresi dolmuş, iptal edilmiş veya daha önce kullanılmış.", 409);
    const creator = await manager(tx, { userId: invitation.createdById, organizationId: invitation.organizationId });
    if (!canAssignRole(creator.role, invitation.role)) throw new AccessError("Davet sahibinin güncel yetkileri bu davet için yeterli değil.", 403);
    const access = await scope(tx, creator, invitation.allBranches, invitation.branches.map((entry) => entry.branchId), invitation.role);
    const existing = await tx.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } } });
    if (existing?.isActive) throw new AccessError("Bu işletmede zaten aktif üyeliğiniz var.", 409);
    if (existing && !canAssignRole(creator.role, existing.role)) throw new AccessError("Bu üyelik yalnızca işletme sahibi tarafından yeniden etkinleştirilebilir.", 403);
    const data = { role: invitation.role, isActive: true, allBranches: access.allBranches };
    const membership = existing ? await tx.membership.update({ where: { id: existing.id }, data }) : await tx.membership.create({ data: { ...data, userId: user.id, organizationId: invitation.organizationId } });
    await assignBranches(tx, membership.id, membership.organizationId, access.branchIds);
    await writeAudit(tx, { userId: user.id, organizationId: membership.organizationId }, "staff.invitation.accept", "Membership", membership.id, undefined, { invitationId: invitation.id, role: membership.role, ...access });
    return { organizationId: membership.organizationId, membershipId: membership.id };
  }, { maxWait: 5000, timeout: 15000 });
}
