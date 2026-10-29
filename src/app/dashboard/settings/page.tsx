import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/rbac";
import { branchIdScope, hasPermission, hasAllBranches, rolePermissions } from "@/lib/permissions";
import SettingsManager from "@/components/settings/SettingsManager";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const actor = await requirePagePermission("settings.read");
  const [branches, session, user, credential] = await Promise.all([
    prisma.branch.findMany({ where: { AND: [{ organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    auth(),
    prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true, accounts: { select: { provider: true } } } }),
    prisma.user.count({ where: { id: actor.userId, password: { not: null } } }),
  ]);
  const signedInAt = session && "authenticatedAt" in session && typeof session.authenticatedAt === "number" ? new Date(session.authenticatedAt).toISOString() : null;
  const activeBranchId = (await cookies()).get("wellpos-active-branch")?.value ?? branches[0]?.id ?? "";
  return <SettingsManager userId={actor.userId} key={actor.organizationId + activeBranchId} activeBranchId={activeBranchId} organizationName={actor.organization.name} branches={branches} canBusiness={hasPermission(actor.role, "settings.organization.manage") && hasAllBranches(actor)} canPolicy={hasPermission(actor.role, "settings.policy.manage")} canBranch={hasPermission(actor.role, "settings.branch.manage")} canPrinter={hasPermission(actor.role, "integrations.manage")} canQr={hasPermission(actor.role, "qr-menu.manage")} security={{ name: user?.name ?? "", email: user?.email ?? "", providers: user?.accounts.map(a => a.provider) ?? [], hasLocalPassword: credential > 0, role: actor.role, permissions: [...(rolePermissions[actor.role] ?? [])], signedInAt, expires: session?.expires ?? null, profileActive: !!actor.profileId }}/ >;
}
