import { Prisma } from "@/generated/prisma/client";
import type { ActiveMembership } from "@/lib/auth-context";
import { CashError } from "@/lib/cash-management";

// The branch ledger is authoritative. Document liabilities are reserved to prevent
// settling them twice through an unallocated account payment and a document payment.
export async function assertCurrentAvailable(tx: Prisma.TransactionClient, actor: ActiveMembership, currentAccountId: string, branchId: string, amount: Prisma.Decimal, incoming: boolean, standalone = false) {
  const groups = await tx.currentAccountEntry.groupBy({ by: ["direction"], where: { organizationId: actor.organizationId, branchId, currentAccountId }, _sum: { amount: true } });
  const net = groups.reduce((n, g) => g.direction === "DEBIT" ? n.plus(g._sum.amount ?? 0) : n.minus(g._sum.amount ?? 0), new Prisma.Decimal(0));
  let available = incoming ? net : net.negated();
  if (standalone) {
    const invoices = await tx.invoice.findMany({ where: { organizationId: actor.organizationId, branchId, currentAccountId, status: "ISSUED", type: incoming ? "SALES" : "PURCHASE" }, select: { grandTotal: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } } });
    for (const invoice of invoices) available = available.minus(invoice.grandTotal.minus(invoice.allocations.reduce((n, a) => n.plus(a.amount), new Prisma.Decimal(0))));
    if (!incoming) {
      const expenses = await tx.expense.findMany({ where: { organizationId: actor.organizationId, branchId, currentAccountId, cancelledAt: null, OR: [{ invoice: null }, { invoice: { status: { not: "ISSUED" } } }] }, select: { amount: true, payments: { where: { cancelledAt: null }, select: { amount: true } } } });
      for (const expense of expenses) available = available.minus(expense.amount.minus(expense.payments.reduce((n, p) => n.plus(p.amount), new Prisma.Decimal(0))));
    }
  }
  if (available.lt(amount)) throw new CashError(standalone ? "Belgesiz kapatılabilir cari bakiye yetersiz. Açık fatura/gider için ilgili belge ödeme türünü seçin. MVP'de avans desteklenmez." : "Tutar şubenin açık cari bakiyesini aşıyor. MVP'de avans desteklenmez.", 409);
}

