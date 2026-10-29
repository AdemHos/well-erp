import { prisma } from "@/lib/prisma";
import { branchPolicy } from "@/lib/settings-policy";
import { getCurrentMembership } from "@/lib/current-membership";
import { getOrderBranchId } from "@/lib/order-access";
import { branchScope, hasPermission } from "@/lib/permissions";
export async function criticalStockAlerts() {
  const actor = await getCurrentMembership();
  if (!actor || !hasPermission(actor.role, "stock.manage")) return { enabled: false, total: 0, rows: [] };
  const branchId = await getOrderBranchId(actor.organizationId);
  if (!branchId) return { enabled: false, total: 0, rows: [] };
  const policy = await branchPolicy(prisma, actor.organizationId, branchId);
  if (!policy.criticalStockEnabled || !policy.notificationsEnabled || !policy.criticalStockNotification) return { enabled: false, total: 0, rows: [] };
  const where = { organizationId: actor.organizationId, branchId, ...branchScope(actor), product: { isActive: true }, quantity: { lte: prisma.branchStock.fields.criticalLevel } };
  const [total, rows] = await Promise.all([
    prisma.branchStock.count({ where }),
    prisma.branchStock.findMany({ where, select: { id: true, quantity: true, criticalLevel: true, product: { select: { name: true, unit: true, isSellable: true } } }, orderBy: [{ quantity: "asc" }, { id: "asc" }], take: 5 }),
  ]);
  return { enabled: true, total, rows: rows.map(row => ({ id: row.id, name: row.product.name, quantity: row.quantity.toString(), criticalLevel: row.criticalLevel.toString(), kind: row.product.isSellable ? "Satılabilir ürün" : "Hammadde", unit: row.product.unit })) };
}
