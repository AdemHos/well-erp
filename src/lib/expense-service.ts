import { activePayments, paymentSelect } from "@/lib/payment-schema";
import { createExpensePayment, issuedExpenseInvoice } from "@/lib/payment-service";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, type Expense } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { type ActiveMembership } from "@/lib/auth-context";
import { branchScope, branchIdScope } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { CashError, cashAmount, serialCashTransaction } from "@/lib/cash-management";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { dateInput, hashRequest, keyInput, onlyFields, text } from "@/lib/current-accounts";
import { expenseFields, expenseInput, expenseVersion, paymentTotals, type ExpenseInput } from "@/lib/expenses";

export type ExpenseContext = { params: Promise<{ id: string }> };
export function expenseError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "İşlem veya kaynak zaten kaydedilmiş.", code: "DUPLICATE" }, { status: 409 });
    if (["P2021", "P2022"].includes(error.code)) return NextResponse.json({ error: "Giderler veritabanı kurulumu henüz uygulanmamış.", code: "SCHEMA_PENDING" }, { status: 503 });
  }
  console.error("EXPENSE_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Gider işlemi tamamlanamadı. Sonucu doğrulamak için aynı istekle tekrar deneyin." }, { status: 500 });
}
export async function expenseRecord(tx: Prisma.TransactionClient, actor: ActiveMembership, id: string) {
  const expense = await tx.expense.findFirst({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) } });
  if (!expense) throw new CashError("Gider bulunamadı veya erişim yetkiniz yok.", 404);
  return expense;
}
async function validateLinks(tx: Prisma.TransactionClient, actor: ActiveMembership, data: ExpenseInput, previous?: Expense) {
  const branch = await tx.branch.findFirst({ where: { AND: [{ id: data.branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true } });
  if (!branch) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
  const category = await tx.financeCategory.findFirst({ where: { id: data.categoryId, organizationId: actor.organizationId, direction: "OUT", ...(previous?.categoryId === data.categoryId ? {} : { isActive: true }) } });
  if (!category) throw new CashError("Aktif gider kategorisi bulunamadı.", 404);
  if (data.currentAccountId) {
    const card = await tx.currentAccount.findFirst({ where: { id: data.currentAccountId, organizationId: actor.organizationId, type: { in: ["SUPPLIER", "BOTH"] }, ...(previous?.currentAccountId === data.currentAccountId ? {} : { isActive: true }) } });
    if (!card) throw new CashError("Aktif tedarikçi / BOTH carisi bulunamadı.", 404);
  }
}
export async function accrual(tx: Prisma.TransactionClient, actor: ActiveMembership, expense: Expense) {
  if (!expense.currentAccountId) return;
  const sourceKey = `expense:${expense.id}:accrual:${expense.version}`;
  return tx.currentAccountEntry.create({ data: {
    organizationId: expense.organizationId, branchId: expense.branchId, currentAccountId: expense.currentAccountId,
    expenseId: expense.id, kind: "EXPENSE", direction: "CREDIT", amount: expense.amount,
    description: `Gider: ${expense.title}`, reference: expense.reference, occurredAt: expense.expenseDate,
    dueAt: expense.dueDate, idempotencyKey: sourceKey, sourceKey, requestHash: hashRequest(sourceKey),
    createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null,
  } });
}
export async function reverseAccrual(tx: Prisma.TransactionClient, actor: ActiveMembership, expense: Expense, reason: string) {
  const original = await tx.currentAccountEntry.findFirst({ where: { expenseId: expense.id, organizationId: expense.organizationId, kind: "EXPENSE", reversals: { none: {} } } });
  if (!original) {
    if (expense.currentAccountId) throw new CashError("Giderin cari tahakkuku doğrulanamadı.", 409);
    return;
  }
  const sourceKey = `expense:${expense.id}:reverse:${original.id}`;
  await tx.currentAccountEntry.create({ data: {
    organizationId: expense.organizationId, branchId: expense.branchId, currentAccountId: original.currentAccountId,
    expenseId: expense.id, kind: "REVERSAL", direction: "DEBIT", amount: original.amount,
    description: reason, reference: original.reference, reversalOfId: original.id,
    occurredAt: original.occurredAt > new Date() ? original.occurredAt : new Date(),
    idempotencyKey: sourceKey, sourceKey, requestHash: hashRequest(sourceKey),
    createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null,
  } });
}
async function retryUnique<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; return work(); }
}
export async function createExpense(request: NextRequest) {
  try {
    const actor = await currentActor(), body = await jsonBody(request);
    onlyFields(body, [...expenseFields, "branchId", "idempotencyKey"]);
    const key = keyInput(body.idempotencyKey), data = expenseInput(body);
    const hash = hashRequest(data);
    const result = await retryUnique(() => serialCashTransaction(prisma, async tx => {
      const accessibleBranch = await tx.branch.findFirst({ where: { AND: [{ id: data.branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true } });
      if (!accessibleBranch) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
      const previous = await tx.expense.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } } });
      if (previous) {
        if (previous.requestHash !== hash) throw new CashError("İstek anahtarı başka bir gider için kullanılmış.", 409);
        return { expense: previous, replayed: true };
      }
      await validateLinks(tx, actor, data);
      const expense = await tx.expense.create({ data: { ...data, organizationId: actor.organizationId, idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      await accrual(tx, actor, expense);
      await writeAudit(tx, actor, "expense.create", "Expense", expense.id, expense.branchId, { amount: expense.amount.toString(), currentAccountId: expense.currentAccountId });
      return { expense, replayed: false };
    }));
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return expenseError(error); }
}
export async function getExpense(_request: NextRequest, context: ExpenseContext) {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const result = await prisma.$transaction(async tx => {
      await expenseRecord(tx, actor, id);
      const expense = await tx.expense.findFirstOrThrow({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) }, include: {
        branch: { select: { id: true, name: true } }, category: { select: { id: true, name: true } },
        currentAccount: { select: { id: true, code: true, name: true } },
        payments: { orderBy: [{ paidAt: "desc" }, { id: "desc" }], select: { ...await paymentSelect(tx), financeTransaction: { include: { account: { select: { id: true, name: true, type: true } } } }, createdBy: { select: { name: true } }, createdByProfile: { select: { name: true } } } },
      } });
      return { ...expense, ...paymentTotals(expense.amount, expense.payments) };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ success: true, expense: result });
  } catch (error) { return expenseError(error); }
}
export async function updateExpense(request: NextRequest, context: ExpenseContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, [...expenseFields, "expectedVersion", "reason"]);
    if (!expenseFields.some(field => field in body)) throw new CashError("Değiştirilecek alan gönderin.");
    const version = expenseVersion(body.expectedVersion);
    const expense = await serialCashTransaction(prisma, async tx => {
      const saved = await expenseRecord(tx, actor, id);
      if (saved.cancelledAt) throw new CashError("İptal edilen gider düzenlenemez.", 409);
      if (await issuedExpenseInvoice(tx, id, actor.organizationId)) throw new CashError("Kesin fatura bağlantılı gider düzenlenemez. Fatura üzerinden işlem yapın.", 409);
      if (saved.version !== version) throw new CashError("Gider değişmiş. Güncel kaydı yükleyin.", 409);
      const data = expenseInput({ ...saved, amount: saved.amount.toString(), expenseDate: saved.expenseDate.toISOString(), dueDate: saved.dueDate?.toISOString() ?? null, ...body });
      const hasPayments = await tx.payment.count({ where: { expenseId: id, organizationId: actor.organizationId } }) > 0;
      const financialChange = !saved.amount.eq(data.amount) || saved.currentAccountId !== data.currentAccountId;
      if (hasPayments && (financialChange || saved.categoryId !== data.categoryId || saved.expenseDate.getTime() !== data.expenseDate.getTime())) throw new CashError("Ödemeli giderin tutarı, carisi, kategorisi ve muhasebe tarihi değiştirilemez.", 409);
      await validateLinks(tx, actor, data, saved);
      const reason = text(body.reason, "düzeltme gerekçesi", 1000, financialChange);
      const accrualChange = financialChange || saved.expenseDate.getTime() !== data.expenseDate.getTime();
      if (accrualChange && saved.currentAccountId) await reverseAccrual(tx, actor, saved, reason ?? "Gider tarihi düzeltildi.");
      const updated = await tx.expense.update({ where: { id, organizationId: actor.organizationId, version }, data: { ...data, version: { increment: 1 } } });
      if (accrualChange) await accrual(tx, actor, updated);
      await writeAudit(tx, actor, "expense.update", "Expense", id, saved.branchId, { previousAmount: saved.amount.toString(), amount: updated.amount.toString(), previousCurrentAccountId: saved.currentAccountId, currentAccountId: updated.currentAccountId, fields: Object.keys(body), reason, version: updated.version });
      return updated;
    });
    return NextResponse.json({ success: true, expense });
  } catch (error) { return expenseError(error); }
}
export async function cancelExpense(request: NextRequest, context: ExpenseContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["expectedVersion", "reason"]);
    const version = expenseVersion(body.expectedVersion), reason = text(body.reason, "iptal gerekçesi", 1000, true)!;
    const expense = await serialCashTransaction(prisma, async tx => {
      const saved = await expenseRecord(tx, actor, id);
      if (saved.cancelledAt) return saved;
      if (await issuedExpenseInvoice(tx, id, actor.organizationId)) throw new CashError("Bağlı faturayı iptal edin; gider aynı işlemde iptal edilir.", 409);
      if (saved.version !== version) throw new CashError("Gider değişmiş. Güncel kaydı yükleyin.", 409);
      if (await tx.payment.count({ where: { expenseId: id, organizationId: actor.organizationId, ...await activePayments(tx) } })) throw new CashError("Ödemesi bulunan gider iptal edilemez.", 409);
      await reverseAccrual(tx, actor, saved, reason);
      const cancelled = await tx.expense.update({ where: { id, version }, data: { cancelledAt: new Date(), cancelledByUserId: actor.userId, cancellationReason: reason, version: { increment: 1 } } });
      await writeAudit(tx, actor, "expense.cancel", "Expense", id, saved.branchId, { reason });
      return cancelled;
    });
    return NextResponse.json({ success: true, expense });
  } catch (error) { return expenseError(error); }
}
export async function payExpense(request: NextRequest, context: ExpenseContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["accountId", "amount", "paidAt", "description", "reference", "idempotencyKey"]);
    const key = keyInput(body.idempotencyKey), amount = cashAmount(body.amount);
    const accountId = text(body.accountId, "ödeme hesabı", 200, true)!;
    const paidAt = dateInput(body.paidAt);
    if (paidAt && paidAt > new Date()) throw new CashError("Gelecekteki bir tarihe ödeme kaydedilemez.");
    const description = text(body.description, "açıklama", 300), reference = text(body.reference, "referans", 100);
    const hash = hashRequest({ id, accountId, amount: amount.toString(), paidAt: paidAt?.toISOString() ?? null, description, reference });
    const digest = hashRequest([actor.organizationId, key]);
    const result = await retryUnique(() => serialCashTransaction(prisma, async tx => {
      const expense = await expenseRecord(tx, actor, id);
      const previous = await tx.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } }, select: await paymentSelect(tx) });
      if (previous) {
        if (previous.requestHash !== hash) throw new CashError("İstek anahtarı farklı bir ödeme için kullanılmış.", 409);
        return { payment: previous, replayed: true };
      }
      if (expense.cancelledAt) throw new CashError("İptal edilen gidere ödeme yapılamaz.", 409);
      const payment = await createExpensePayment(tx, actor, expense, { accountId, amount, paidAt, description, reference, key, hash, digest });
      return { payment, replayed: false };
    }));
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return expenseError(error); }
}
