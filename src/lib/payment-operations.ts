import { assertCurrentAvailable } from "@/lib/payment-balance";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { branchIdScope, branchScope, hasPermission } from "@/lib/permissions";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { dateInput, hashRequest, keyInput, onlyFields, text } from "@/lib/current-accounts";
import { assertCashAvailable, cashAmount, CashError, serialCashTransaction } from "@/lib/cash-management";
import { createExpensePayment, allocatePayment } from "@/lib/payment-service";
import { writeAudit } from "@/lib/audit";
import { isCollection, paymentTypes, type PaymentKind } from "@/lib/payments";

export function paymentError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2021", "P2022"].includes(error.code) || (error.code === "P2010" && ["42703", "42P01"].includes(String(error.meta?.code)))) return NextResponse.json({ error: "Ödemeler şema güncellemesi bekleniyor.", code: "SCHEMA_PENDING" }, { status: 503 });
    if (["P2002", "P2034"].includes(error.code)) return NextResponse.json({ error: "İşlem çakıştı. Aynı istek anahtarıyla tekrar deneyin." }, { status: 409 });
  }
  console.error("PAYMENT_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Ödeme sonucu doğrulanamadı. Aynı istekle tekrar deneyin." }, { status: 500 });
}
export async function paymentActor() {
  const actor = await currentActor();
  if (!hasPermission(actor.role, "finance.manage")) throw new CashError("Bu işlem için yetkiniz yok.", 403);
  return actor;
}


export async function createPayment(request: NextRequest) {
  try {
    const actor = await paymentActor(), body = await jsonBody(request);
    onlyFields(body, ["type", "branchId", "currentAccountId", "expenseId", "invoiceId", "accountId", "amount", "paidAt", "description", "reference", "idempotencyKey"]);
    if (typeof body.type !== "string" || !Object.hasOwn(paymentTypes, body.type)) throw new CashError("Geçerli işlem türü seçin.");
    const type = body.type as PaymentKind, incoming = isCollection(type);
    const branchId = text(body.branchId, "şube", 200, true)!, accountId = text(body.accountId, "ödeme hesabı", 200, true)!;
    const currentAccountId = text(body.currentAccountId, "cari", 200), expenseId = text(body.expenseId, "gider", 200), invoiceId = text(body.invoiceId, "fatura", 200);
    const invoiceType = type === "PURCHASE_INVOICE_PAYMENT" || type === "SALES_INVOICE_COLLECTION";
    if (invoiceType !== !!invoiceId || (type === "EXPENSE_PAYMENT") !== !!expenseId || ((invoiceType || type === "EXPENSE_PAYMENT") ? false : !currentAccountId)) throw new CashError("İşlem türüne uygun belge/cari seçin.");
    const key = keyInput(body.idempotencyKey), amount = cashAmount(body.amount), paidAt = dateInput(body.paidAt);
    if (paidAt && paidAt > new Date()) throw new CashError("Geleceğe ödeme kaydedilemez.");
    const description = text(body.description, "açıklama", 300), reference = text(body.reference, "referans", 100);
    // Preserve the established expense endpoint's hash and deterministic IDs.
    const hash = type === "EXPENSE_PAYMENT" ? hashRequest({ id: expenseId, accountId, amount: amount.toString(), paidAt: paidAt?.toISOString() ?? null, description, reference }) : hashRequest({ type, branchId, currentAccountId, expenseId, invoiceId, accountId, amount: amount.toString(), paidAt: paidAt?.toISOString() ?? null, description, reference });
    const digest = hashRequest([actor.organizationId, key]);
    const work = () => serialCashTransaction(prisma, async tx => {
      if (!await tx.branch.findFirst({ where: { AND: [{ id: branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true } })) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
      const previous = await tx.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } } });
      if (previous) {
        if (previous.requestHash !== hash || previous.branchId !== branchId || (currentAccountId && previous.currentAccountId !== currentAccountId)) throw new CashError("İstek anahtarı başka bir ödeme için kullanılmış.", 409);
        return { payment: previous, replayed: true };
      }
      const invoice = invoiceId ? await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId, branchId, status: "ISSUED", type: incoming ? "SALES" : "PURCHASE", orderId: null } }) : null;
      if (invoiceId && !invoice) throw new CashError("Uygun kesin fatura bulunamadı. POS kayıtları yeniden tahsil edilemez.", 409);
      const linkedExpenseId = expenseId ?? invoice?.expenseId;
      const expense = linkedExpenseId ? await tx.expense.findFirst({ where: { id: linkedExpenseId, organizationId: actor.organizationId, branchId, cancelledAt: null } }) : null;
      if (linkedExpenseId && !expense) throw new CashError("Aktif gider bulunamadı.", 404);
      const cardId = invoice ? invoice.currentAccountId : expense ? expense.currentAccountId : currentAccountId;
      if (invoice && expense && (expense.currentAccountId !== invoice.currentAccountId || !expense.amount.eq(invoice.grandTotal))) throw new CashError("Bağlı gider ve fatura tutarlı değil.", 409);
      if (currentAccountId && currentAccountId !== cardId) throw new CashError("Belge ve cari uyuşmuyor.", 409);
      if (cardId) {
        if (!await tx.currentAccount.findFirst({ where: { id: cardId, organizationId: actor.organizationId, isActive: true, type: { in: incoming ? ["CUSTOMER", "BOTH"] : ["SUPPLIER", "BOTH"] } } })) throw new CashError("İşlem türüne uygun aktif cari bulunamadı.", 409);
        await assertCurrentAvailable(tx, actor, cardId, branchId, amount, incoming, !invoice && !expense);
      }
      if (invoice) {
        const paid = await tx.invoicePaymentAllocation.aggregate({ where: { invoiceId: invoice.id, payment: { cancelledAt: null } }, _sum: { amount: true } });
        if ((paid._sum.amount ?? new Prisma.Decimal(0)).plus(amount).gt(invoice.grandTotal)) throw new CashError("Ödeme fatura kalanını aşamaz.", 409);
      }
      if (expense) {
        const payment = await createExpensePayment(tx, actor, expense, { accountId, amount, paidAt, description, reference, key, hash, digest, type });
        return { payment, replayed: false };
      }
      const account = await tx.financeAccount.findFirst({ where: { id: accountId, organizationId: actor.organizationId, branchId, isActive: true, type: { in: ["CASH", "BANK"] } } });
      if (!account) throw new CashError("Aynı şubede aktif nakit/banka hesabı seçin. POS hesabı kullanılamaz.", 409);
      if (!incoming) await assertCashAvailable(tx, account, amount);
      const at = paidAt ?? new Date(), id = `payment-${digest}`;
      const movement = await tx.financeTransaction.create({ data: { id, organizationId: actor.organizationId, branchId, accountId, source: "PAYMENT", direction: incoming ? "IN" : "OUT", amount, occurredAt: at, description: `${paymentTypes[type]}${description ? " — " + description : ""}`, reference: reference ?? id } });
      const entry = await tx.currentAccountEntry.create({ data: { organizationId: actor.organizationId, branchId, currentAccountId: cardId!, kind: incoming ? "COLLECTION" : "PAYMENT", direction: incoming ? "CREDIT" : "DEBIT", amount, occurredAt: at, description, reference: reference ?? id, financeTransactionId: movement.id, sourceKey: id, idempotencyKey: id, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      const payment = await tx.payment.create({ data: { id, organizationId: actor.organizationId, branchId, type, currentAccountId: cardId, amount, paidAt: at, description, reference, financeTransactionId: movement.id, currentAccountEntryId: entry.id, idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      if (invoice) await allocatePayment(tx, actor, invoice, payment);
      await writeAudit(tx, actor, "payment.create", "Payment", payment.id, branchId, { type, amount: amount.toString(), invoiceId, financeTransactionId: movement.id, currentAccountEntryId: entry.id });
      return { payment, replayed: false };
    });
    let result;
    try { result = await work(); } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; result = await work(); }
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return paymentError(error); }
}

export async function cancelPayment(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await paymentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["reason"]);
    const reason = text(body.reason, "iptal gerekçesi", 1000, true)!;
    const payment = await serialCashTransaction(prisma, async tx => {
      const saved = await tx.payment.findFirst({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) }, include: { financeTransaction: { include: { account: true } }, currentAccountEntry: true } });
      if (!saved) throw new CashError("Ödeme bulunamadı.", 404);
      if (saved.cancelledAt) throw new CashError("Ödeme zaten iptal edilmiş.", 409);
      const original = saved.financeTransaction, entry = saved.currentAccountEntry;
      if (original.direction !== (isCollection(saved.type) ? "IN" : "OUT")) throw new CashError("Ödeme yönü doğrulanamadı.", 409);
      if (original.account.organizationId !== saved.organizationId || original.account.branchId !== saved.branchId || !["PAYMENT", "EXPENSE_PAYMENT"].includes(original.source) || original.orderId || !original.amount.eq(saved.amount)) throw new CashError("Ödeme kasa bağlantısı doğrulanamadı.", 409);
      if (entry && (!entry.amount.eq(saved.amount) || entry.financeTransactionId !== original.id || entry.currentAccountId !== saved.currentAccountId)) throw new CashError("Ödeme cari bağlantısı doğrulanamadı.", 409);
      if (original.direction === "IN") await assertCashAvailable(tx, original.account, saved.amount);
      const at = new Date(), reverseId = `payment-reversal-${id}`;
      const movement = await tx.financeTransaction.create({ data: { id: reverseId, organizationId: saved.organizationId, branchId: saved.branchId, accountId: original.accountId, categoryId: original.categoryId, source: "PAYMENT_REVERSAL", direction: original.direction === "IN" ? "OUT" : "IN", amount: saved.amount, occurredAt: at, reference: saved.reference ?? saved.id, description: `Ödeme iptali ${id}: ${reason}` } });
      const reversal = entry ? await tx.currentAccountEntry.create({ data: { organizationId: saved.organizationId, branchId: saved.branchId, currentAccountId: entry.currentAccountId, expenseId: entry.expenseId, kind: "REVERSAL", direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT", amount: entry.amount, occurredAt: at, reference: saved.reference ?? id, description: reason, reversalOfId: entry.id, financeTransactionId: movement.id, sourceKey: reverseId, idempotencyKey: reverseId, requestHash: hashRequest([id, reason]), createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } }) : null;
      const updated = await tx.payment.update({ where: { id, cancelledAt: null }, data: { cancelledAt: at, cancelledByUserId: actor.userId, cancelledByProfileId: actor.profileId ?? null, cancellationReason: reason, reversalFinanceTransactionId: movement.id, reversalCurrentAccountEntryId: reversal?.id ?? null } });
      if (saved.expenseId) await tx.expense.update({ where: { id: saved.expenseId }, data: { version: { increment: 1 } } });
      await writeAudit(tx, actor, "payment.cancel", "Payment", id, saved.branchId, { reason, reversalFinanceTransactionId: movement.id, reversalCurrentAccountEntryId: reversal?.id ?? null });
      return updated;
    });
    return NextResponse.json({ success: true, payment });
  } catch (error) { return paymentError(error); }
}
