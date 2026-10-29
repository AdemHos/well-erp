import { requirePagePermission } from "@/lib/rbac";
import { redirect } from "next/navigation";

import OrderManager from "@/components/orders/OrderManager";
import { canRefundOrders, getOrderBranchId } from "@/lib/order-access";
import { branchPolicy } from "@/lib/settings-policy";
import { prisma } from "@/lib/prisma";

export default async function OrdersPage() {
  const membership = await requirePagePermission("orders.read");

  if (!membership) {
    redirect("/onboarding");
  }

  const branchId = await getOrderBranchId(membership.organizationId);
  const policy = branchId ? await branchPolicy(prisma, membership.organizationId, branchId) : null;
  return <OrderManager key={branchId ?? "no-branch"} canRefund={canRefundOrders(membership.role) && !!policy?.refundRoles.includes(membership.role)} />;
}
