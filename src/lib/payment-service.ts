import { activePayments, paymentSchemaReady, paymentSelect } from "@/lib/payment-schema";
import { assertCurrentAvailable } from "@/lib/payment-balance";
import { isCollection, type PaymentKind } from "@/lib/payments";
import { Prisma, type Invoice, type Payment, type Expense } from "@/generated/prisma/client";
import type { ActiveMembership } from "@/lib/auth-context";
import { assertCashAvailable, CashError } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";

// Existing Expenses remains usable before the separately approved invoice migration.
export async function issuedExpenseInvoice(tx: Prisma.TransactionClient, expenseId: string, organizationId: string) {
  const [schema] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."Invoice"') IS NOT NULL AS ready`;
  if (!schema?.ready) return null;
  return tx.invoice.findFirst({ where: { expenseId, organizationId, status: "ISSUED" } });
}

// A distribution of an existing payment: never creates cash or a second ledger entry.
export async function allocatePayment(tx: Prisma.TransactionClient, actor: ActiveMembership, invoice: Invoice, payment: Payment) {
  if (invoice.status !== "ISSUED" || invoice.organizationId !== payment.organizationId || invoice.branchId !== payment.branchId || payment.cancelledAt || (invoice.expenseId ? invoice.type !== "PURCHASE" || invoice.expenseId !== payment.expenseId : payment.expenseId !== null)) throw new CashError("Ödeme fatura kapsamıyla uyuşmuyor.", 409);
  const previous = await tx.invoicePaymentAllocation.findUnique({ where: { invoiceId_paymentId: { invoiceId: invoice.id, paymentId: payment.id } } });
  if (previous) {
    if (!previous.amount.eq(payment.amount)) throw new CashError("Ödeme tahsisi tutarsız.", 409);
    return previous;
  }
  const movement = await tx.financeTransaction.findFirst({ where: { id: payment.financeTransactionId, organizationId: invoice.organizationId, branchId: invoice.branchId, direction: invoice.type === "SALES" ? "IN" : "OUT", amount: payment.amount } });
  const entry = payment.currentAccountEntryId ? await tx.currentAccountEntry.findFirst({ where: { id: payment.currentAccountEntryId, organizationId: invoice.organizationId, branchId: invoice.branchId, currentAccountId: invoice.currentAccountId, direction: invoice.type === "SALES" ? "CREDIT" : "DEBIT", kind: invoice.type === "SALES" ? "COLLECTION" : "PAYMENT", financeTransactionId: payment.financeTransactionId, amount: payment.amount, reversals: { none: {} } } }) : null;
  if (!movement || !entry) throw new CashError("Ödemenin kasa/cari bağlantısı doğrulanamadı.", 409);
  const used = await tx.invoicePaymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
  const paid = await tx.invoicePaymentAllocation.aggregate({ where: { invoiceId: invoice.id, payment: await activePayments(tx) }, _sum: { amount: true } });
  if ((used._sum.amount ?? new Prisma.Decimal(0)).plus(payment.amount).gt(payment.amount) || (paid._sum.amount ?? new Prisma.Decimal(0)).plus(payment.amount).gt(invoice.grandTotal)) throw new CashError("Tahsis ödeme/fatura tutarını aşamaz.", 409);
  const allocation = await tx.invoicePaymentAllocation.create({ data: { invoiceId: invoice.id, paymentId: payment.id, organizationId: invoice.organizationId, branchId: invoice.branchId, amount: payment.amount, createdByUserId: actor.userId } });
  await writeAudit(tx, actor, "invoice.payment.allocate", "Invoice", invoice.id, invoice.branchId, { paymentId: payment.id, amount: payment.amount.toString() });
  return allocation;
}

export async function createExpensePayment(tx: Prisma.TransactionClient, actor: ActiveMembership, expense: Expense, input: { accountId: string; amount: Prisma.Decimal; paidAt: Date | undefined; description: string | null; reference: string | null; key: string; hash: string; digest: string; type?: PaymentKind }) {
  const { accountId, amount, paidAt, description, reference, key, hash, digest } = input;
  const ready = await paymentSchemaReady(tx);
  if (isCollection(input.type ?? "EXPENSE_PAYMENT")) throw new CashError("Gider için tahsilat oluşturulamaz.");
  if (expense.currentAccountId) await assertCurrentAvailable(tx, actor, expense.currentAccountId, expense.branchId, amount, false);
  const account = await tx.financeAccount.findFirst({ where: { id: accountId, organizationId: actor.organizationId, branchId: expense.branchId, isActive: true, type: { in: ["CASH", "BANK"] } } });
  if (!account) throw new CashError("Giderle aynı şubede aktif nakit/banka hesabı seçin. POS tahsilat hesabı kullanılamaz.", 409);
  const sum = await tx.payment.aggregate({ where: { expenseId: expense.id, organizationId: actor.organizationId, ...await activePayments(tx) }, _sum: { amount: true } });
  if ((sum._sum.amount ?? new Prisma.Decimal(0)).plus(amount).gt(expense.amount)) throw new CashError("Ödeme kalan gider tutarını aşamaz.", 409);
  await assertCashAvailable(tx, account, amount);
  const at = paidAt ?? new Date();
  const movement = await tx.financeTransaction.create({ data: {
    id: `expense-payment-${digest}`, organizationId: actor.organizationId, branchId: expense.branchId,
    accountId: account.id, categoryId: expense.categoryId, source: "EXPENSE_PAYMENT", direction: "OUT", amount,
    description: `Gider: ${expense.title}${description ? " — " + description : ""}`, reference: reference ?? expense.reference ?? `expense-payment-${digest}`, occurredAt: at,
  } });
  const sourceKey = `expense-payment:${digest}`;
  const entry = expense.currentAccountId ? await tx.currentAccountEntry.create({ data: {
    organizationId: actor.organizationId, branchId: expense.branchId, currentAccountId: expense.currentAccountId,
    expenseId: expense.id, kind: "PAYMENT", direction: "DEBIT", amount, description: `Gider ödemesi: ${expense.title}${description ? " — " + description : ""}`,
    reference: reference ?? expense.reference ?? `expense-payment-${digest}`, occurredAt: at, financeTransactionId: movement.id,
    sourceKey, idempotencyKey: sourceKey, requestHash: hash,
    createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null,
  } }) : null;
  const payment = await tx.payment.create({ data: {
    id: `expense-payment-${digest}`, organizationId: actor.organizationId, branchId: expense.branchId, expenseId: expense.id,
    ...(ready ? { type: input.type ?? "EXPENSE_PAYMENT", currentAccountId: expense.currentAccountId } : {}),
    amount, paidAt: at, description, reference, financeTransactionId: movement.id, currentAccountEntryId: entry?.id ?? null,
    idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null,
  }, select: await paymentSelect(tx) });
  const linkedInvoice = await issuedExpenseInvoice(tx, expense.id, actor.organizationId);
  if (linkedInvoice) await allocatePayment(tx, actor, linkedInvoice, payment);
  await tx.expense.update({ where: { id: expense.id }, data: { version: { increment: 1 } } });
  await writeAudit(tx, actor, "expense.payment.create", "ExpensePayment", payment.id, expense.branchId, { expenseId: expense.id, amount: amount.toString(), financeTransactionId: movement.id, currentAccountEntryId: entry?.id ?? null });

  return payment;
}
