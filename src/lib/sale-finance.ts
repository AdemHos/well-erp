import type { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";

export async function saleAccount(tx: Prisma.TransactionClient, organizationId: string, branchId: string, method: "CASH" | "CARD", selected?: string) {
  const accounts = await tx.financeAccount.findMany({ where: { AND: [{ organizationId, branchId, type: method, isActive: true, ...(selected ? { id: selected } : {}) }] }, select: { id: true }, take: 2 });
  if (!accounts.length) throw new CashError("Bu şube ve ödeme yöntemi için aktif finans hesabı bulunamadı.", 409);
  if (accounts.length > 1) throw new CashError("Birden fazla aktif finans hesabı var. Tahsilat hesabını seçin.", 409);
  return accounts[0].id;
}

export async function recordSaleFinance(tx: Prisma.TransactionClient, order: { id: string; organizationId: string; branchId: string; orderNumber: string; total: Prisma.Decimal; createdAt: Date }, accountId: string) {
  return tx.financeTransaction.create({ data: { organizationId: order.organizationId, branchId: order.branchId, accountId, orderId: order.id,
    direction: "IN", source: "POS_SALE", amount: order.total, occurredAt: order.createdAt,
    description: `POS Satışı: ${order.orderNumber}`, reference: order.orderNumber } });
}
