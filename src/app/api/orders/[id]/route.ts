import { orderCustomerOmit } from "@/lib/customer-schema";
import { withPermission } from "@/lib/rbac";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { getOrderBranchId, orderReceiptInclude } from "@/lib/order-access";
type Context = { params: Promise<{ id: string }> };
async function handleGET(_request: Request, { params }: Context) {
  try {
    const membership = await getCurrentMembership();
    if (!membership) return NextResponse.json({ error: "Yetkisiz işlem." }, { status: 401 });
    const branchId = await getOrderBranchId(membership.organizationId);
    const { id } = await params;
    const order = await prisma.order.findFirst({ where: { id, organizationId: membership.organizationId, branchId: branchId ?? "" }, omit: await orderCustomerOmit(prisma), include: orderReceiptInclude });
    if (!order) return NextResponse.json({ error: "Aktif şubede satış bulunamadı." }, { status: 404 });
    return NextResponse.json({ order });
  } catch {
    return NextResponse.json({ error: "Satış detayı alınamadı." }, { status: 500 });
  }
}
// CANCELLED is reserved for an unpaid/abandoned flow, not completed sales.
async function handlePATCH(request: Request, context: Context) {
  const result = await GET(request, context);
  if (!result.ok) return result;
  return NextResponse.json({ error: "Tamamlanmış satış yalnızca tam iade akışıyla geri alınabilir. Durum değiştirerek iptal desteklenmiyor." }, { status: 409 });
}

export const GET = withPermission("orders.read", handleGET);

export const PATCH = withPermission("orders.refund", handlePATCH);
