import { orderCustomerOmit } from "@/lib/customer-schema";
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { customerActor, customerError, customerRecord } from "@/lib/customer-service";
import { branchScope } from "@/lib/permissions";
import { CashError } from "@/lib/cash-management";
import { orderReceiptInclude } from "@/lib/order-access";
export const GET = withPermission("customers.read", async (_request: NextRequest, context: { params: Promise<{ id: string; orderId: string }> }) => {
  try {
    const actor = await customerActor("orders.read"), { id, orderId } = await context.params;
    await customerRecord(prisma, actor, id);
    const order = await prisma.order.findFirst({ where: { id: orderId, customerId: id, organizationId: actor.organizationId, ...branchScope(actor) }, omit: await orderCustomerOmit(prisma), include: orderReceiptInclude });
    if (!order) throw new CashError("Bu müşteri ve yetkili şubelerde satış bulunamadı.", 404);
    return NextResponse.json({ order });
  } catch (error) { return customerError(error); }
});
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
