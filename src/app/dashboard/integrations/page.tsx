import { requirePagePermission } from "@/lib/rbac";
import { branchIdScope, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import IntegrationsManager from "@/components/integrations/IntegrationsManager";

export const dynamic = "force-dynamic";
export default async function IntegrationsPage() {
  const actor = await requirePagePermission("integrations.read");
  const branches = await prisma.branch.findMany({ where: { AND: [{ organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <IntegrationsManager branches={branches} organizationName={actor.organization.name} canManage={hasPermission(actor.role, "integrations.manage")} />;
}
