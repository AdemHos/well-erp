import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { allowedBranchIds, branchIdScope, canAssignRole, hasAllBranches, hasPermission, rolePermissions } from "@/lib/permissions";
import { saveLocalProfile } from "@/lib/staff-profiles";

export const GET = withPermission("staff.read", async () => {
  const member = (await getCurrentMembership())!;
  const all = hasAllBranches(member); const ids = allowedBranchIds(member);
  const [profiles, branches] = await Promise.all([
    prisma.staffProfile.findMany({ where: { organizationId: member.organizationId, membershipId: null, ...(all ? {} : { allBranches: false, branchAccess: { every: { branchId: { in: ids } }, some: { branchId: { in: ids } } } }) }, select: { id: true, name: true, role: true, isActive: true, branchAccess: { select: { branchId: true } } }, orderBy: { createdAt: "asc" }, take: 500 }),
    prisma.branch.findMany({ where: { organizationId: member.organizationId, ...branchIdScope(member) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ profiles: profiles.map((p) => ({ ...p, canEdit: hasPermission(member.role, "staff.manage") && canAssignRole(member.role, p.role) })), branches,
    canManage: hasPermission(member.role, "staff.manage"), roles: Object.keys(rolePermissions).filter((r) => r !== "OWNER" && canAssignRole(member.role, r)) });
});
export const POST = withPermission("staff.manage", async (request: Request) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Personel bilgileri geçersiz.", 400);
  return NextResponse.json(await saveLocalProfile((await getCurrentMembership())!, null, body), { status: 201 });
});
