import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchIdScope, hasPermission } from "@/lib/permissions";

export async function getOrderBranchId(organizationId: string) {
  const membership = await getCurrentMembership();
  if (!membership || membership.organizationId !== organizationId) return null;
  const scope = { organizationId, ...branchIdScope(membership) };
  const savedId = (await cookies()).get("wellpos-active-branch")?.value;
  if (savedId) {
    const branch = await prisma.branch.findFirst({ where: { AND: [{ id: savedId }, scope] }, select: { id: true } });
    if (branch) return branch.id;
  }
  return (await prisma.branch.findFirst({ where: scope, orderBy: { name: "asc" }, select: { id: true } }))?.id ?? null;
}
export const canRefundOrders = (role: string) => hasPermission(role, "orders.refund");
export const orderReceiptInclude = {
  organization: { select: { name: true } },
  branch: { select: { id: true, name: true } },
  items: { select: { id: true, productId: true, productName: true, quantity: true, unitPrice: true, total: true }, orderBy: { id: "asc" as const } },
};
