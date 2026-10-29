import { requirePagePermission } from "@/lib/rbac";
import { branchIdScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import QrMenuManager from "@/components/qr-menu/QrMenuManager";
export default async function QrMenuPage() {
  const actor = await requirePagePermission("qr-menu.manage");
  const branches = await prisma.branch.findMany({ where: { organizationId: actor.organizationId, ...branchIdScope(actor) }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return <QrMenuManager branches={branches}/>;
}
