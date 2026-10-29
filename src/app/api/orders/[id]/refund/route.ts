import { assertCashAvailable, CashError, serialCashTransaction } from "@/lib/cash-management";
import { branchPolicy } from "@/lib/settings-policy";
import { orderCustomerOmit, legacyCustomerOmit } from "@/lib/customer-schema";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { getOrderBranchId, orderReceiptInclude } from "@/lib/order-access";
import { Prisma } from "@/generated/prisma/client";

class RefundError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

async function handlePOST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const membership = await getCurrentMembership();
    if (!membership) return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    
    const branchId = await getOrderBranchId(membership.organizationId);
    const { id } = await context.params;
    const scope = { id, organizationId: membership.organizationId, branchId: branchId ?? "" };
    const body = await _request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) throw new RefundError("İade açıklaması geçersiz.", 400);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const order = await serialCashTransaction(prisma, async (tx) => {
      const policy = await branchPolicy(tx, membership.organizationId, branchId ?? "", true);
      if (!policy.refundRoles.includes(membership.role)) throw new RefundError("Bu şubede iade yapma yetkiniz yok.", 403);
      if (policy.refundReasonRequired && reason.length < 3) throw new RefundError("En az 3 karakterlik iade açıklaması zorunludur.", 400);
      // This conditional UPDATE locks the row. A concurrent request waits and
      // then sees REFUNDED; only one request can restore stock or issue money.
      const claimed = await tx.order.updateMany({ where: { ...scope, status: "COMPLETED" }, data: { status: "REFUNDED" } });
      if (claimed.count !== 1) {
        const existing = await tx.order.findFirst({ where: scope, select: { id: true } });
        throw new RefundError(existing ? "Bu satış daha önce iade edilmiş, iptal edilmiş veya iadeye uygun değil." : "Aktif şubede satış bulunamadı.", existing ? 409 : 404);
      }
      const saved = await tx.order.findFirstOrThrow({ where: scope, omit: legacyCustomerOmit, include: {
        items: true,
        financeTransactions: { where: { source: { in: ["POS_SALE", "POS_REFUND"] } }, include: { account: true } },
      } });
      if (saved.total.lt(0) || saved.items.length === 0) throw new RefundError("Satış tutarı veya ürün kayıtları iadeye uygun değil.");
      if (saved.financeTransactions.some((entry) => entry.source === "POS_REFUND")) throw new RefundError("Bu satış için finans iadesi zaten kayıtlı.");
      const sale = saved.financeTransactions.find((entry) => entry.source === "POS_SALE");
      if (saved.total.gt(0) && (!sale || sale.direction !== "IN" || !sale.amount.eq(saved.total) ||
        sale.organizationId !== saved.organizationId || sale.branchId !== saved.branchId ||
        sale.account.organizationId !== saved.organizationId || sale.account.branchId !== saved.branchId)) {
        throw new RefundError("İlk satışın finans kaydı bulunamadı veya tutar/hesap bilgileri uyuşmuyor. Otomatik iade yapılamaz; finans kayıtlarını kontrol edin.");
      }
      if (saved.total.eq(0) && sale) throw new RefundError("Sıfır tutarlı satışın finans kaydı incelenmeli; otomatik iade yapılamaz.");
      const quantities = new Map<string, Prisma.Decimal>();
      for (const item of saved.items) {
        if (!item.productId || !item.quantity.gt(0)) throw new RefundError("Satıştaki bir ürün silinmiş veya miktarı geçersiz. Stok iadesi güvenle yapılamıyor.");
        quantities.set(item.productId, (quantities.get(item.productId) ?? new Prisma.Decimal(0)).plus(item.quantity));
      }
      const products = await tx.product.findMany({ where: { organizationId: saved.organizationId, id: { in: [...quantities.keys()] } }, select: { id: true } });
      if (products.length !== quantities.size) throw new RefundError("Satış ürünleri işletmeyle eşleşmiyor.");
      for (const [productId, quantity] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const stock = await tx.branchStock.upsert({
          where: { branchId_productId: { branchId: saved.branchId, productId } },
          create: { organizationId: saved.organizationId, branchId: saved.branchId, productId, quantity, criticalLevel: policy.defaultCriticalLevel },
          update: { quantity: { increment: quantity } },
        });
        if (stock.organizationId !== saved.organizationId) throw new RefundError("Stok kaydı işletmeyle eşleşmiyor.");
        await tx.stockMovement.create({ data: {
          organizationId: saved.organizationId, branchId: saved.branchId, productId, type: "RETURN", quantity,
          reference: saved.orderNumber, note: `Tam iade: ${saved.orderNumber}; Yetkili: ${membership.userId}`,
        } });
      }
      if (saved.total.gt(0) && sale) {
        await assertCashAvailable(tx, sale.account, saved.total);
        // Refund to the original account even if it has since been deactivated.
        await tx.financeTransaction.create({ data: {
          organizationId: saved.organizationId, branchId: saved.branchId, accountId: sale.accountId,
          orderId: saved.id, direction: "OUT", source: "POS_REFUND", amount: saved.total,
          description: `POS İadesi: ${saved.orderNumber}; Yetkili: ${membership.userId}`, reference: saved.orderNumber,
        } });
      }
      await writeAudit(tx, membership, "orders.refund", "Order", saved.id, saved.branchId, { total: saved.total.toString(), orderNumber: saved.orderNumber, ...(reason ? { reason } : {}) });
      return tx.order.findFirstOrThrow({ where: scope, omit: await orderCustomerOmit(tx), include: orderReceiptInclude });
    });
    return NextResponse.json({ message: order.total.eq(0)
      ? "Sıfır tutarlı satış iade edildi. Stok geri eklendi; finans hareketi oluşturulmadı."
      : "Tam iade tamamlandı. Stok ve finans kayıtları güncellendi.", order });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof RefundError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Bu satış için iade kaydı zaten mevcut." }, { status: 409 });
    console.error("REFUND_ORDER_ERROR:", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "İade tamamlanamadı. Hiçbir kısmi işlem kaydedilmedi; satışın durumunu yenileyin." }, { status: 500 });
  }
}

export const POST = withPermission("orders.refund", handlePOST);
