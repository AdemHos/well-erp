import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { withPermission } from "@/lib/rbac";
import { allowedBranchIds, branchIdScope, canAssignRole, hasAllBranches, hasPermission, rolePermissions } from "@/lib/permissions";

export const GET = withPermission("staff.read", async () => {
  const member = (await getCurrentMembership())!;
  const unrestricted = hasAllBranches(member);
  const ids = allowedBranchIds(member);
  const [memberships, invitations, branches] = await Promise.all([
    prisma.membership.findMany({ where: { organizationId: member.organizationId,
      ...(unrestricted ? {} : { OR: [{ userId: member.userId }, { allBranches: true }, { branchAccess: { some: { isActive: true, branchId: { in: ids } } } }] }),
    }, select: { id: true, role: true, isActive: true, allBranches: true, user: { select: { id: true, name: true, email: true } },
      _count: { select: { branchAccess: { where: { isActive: true } } } },
      branchAccess: { where: { isActive: true, ...(unrestricted ? {} : { branchId: { in: ids } }) }, select: { branchId: true } },
    }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }], take: 500 }),
    prisma.staffInvitation.findMany({ where: { organizationId: member.organizationId,
      ...(unrestricted ? {} : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: ids } } } }] }),
    }, select: { id: true, email: true, role: true, allBranches: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true,
      branches: { where: unrestricted ? {} : { branchId: { in: ids } }, select: { branchId: true } },
    }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.branch.findMany({ where: { organizationId: member.organizationId, ...branchIdScope(member) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ memberships: memberships.map((entry) => ({ ...entry, _count: undefined,
    canEdit: hasPermission(member.role, "staff.manage") && canAssignRole(member.role, entry.role) && (unrestricted || (!entry.allBranches && entry._count.branchAccess === entry.branchAccess.length)),
  })), invitations: invitations.map((entry) => ({ ...entry, isPending: !entry.acceptedAt && !entry.revokedAt && entry.expiresAt.getTime() > Date.now() })), branches, canManage: hasPermission(member.role, "staff.manage"), canAudit: hasPermission(member.role, "audit.read"),
    assignableRoles: Object.keys(rolePermissions).filter((role) => canAssignRole(member.role, role)),
    canAssignAllBranches: unrestricted, currentMembershipId: member.id, currentRole: member.role });
});
