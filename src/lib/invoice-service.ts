import { activePayments, paymentSelect } from "@/lib/payment-schema";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ActiveMembership } from "@/lib/auth-context";
import { branchIdScope, branchScope } from "@/lib/permissions";
import { CashError, serialCashTransaction } from "@/lib/cash-management";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { hashRequest, keyInput, onlyFields, text } from "@/lib/current-accounts";
import { invoiceFields, invoiceInput } from "@/lib/invoices";
import { expenseVersion, paymentTotals } from "@/lib/expenses";
import { accrual, reverseAccrual } from "@/lib/expense-service";
import { allocatePayment } from "@/lib/payment-service";
import { writeAudit } from "@/lib/audit";

export type InvoiceContext = { params: Promise<{ id: string }> };
export function invoiceError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "Fatura numarası, kaynak veya istek zaten kaydedilmiş.", code: "DUPLICATE" }, { status: 409 });
    if (["P2021", "P2022"].includes(error.code)) return NextResponse.json({ error: "Faturalar veritabanı migration'ı henüz uygulanmamış.", code: "SCHEMA_PENDING" }, { status: 503 });
  }
  console.error("INVOICE_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Fatura işlemi tamamlanamadı. Sonucu doğrulayarak tekrar deneyin." }, { status: 500 });
}
export async function invoiceRecord(tx: Prisma.TransactionClient, actor: ActiveMembership, id: string) {
  const invoice = await tx.invoice.findFirst({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) }, include: { items: { orderBy: { position: "asc" } }, currentAccount: true, branch: { select: { id: true, name: true } }, organization: { select: { name: true } }, allocations: { orderBy: { createdAt: "asc" }, include: { payment: { select: { ...await paymentSelect(tx), financeTransaction: { include: { account: { select: { name: true } } } } } } } } } });
  if (!invoice) throw new CashError("Fatura bulunamadı veya erişim yetkiniz yok.", 404);
  return invoice;
}
type Input = ReturnType<typeof invoiceInput>;
async function validate(tx: Prisma.TransactionClient, actor: ActiveMembership, data: Input) {
  if (!await tx.branch.findFirst({ where: { AND: [{ id: data.branchId, organizationId: actor.organizationId }, branchIdScope(actor)] } })) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
  const account = await tx.currentAccount.findFirst({ where: { id: data.currentAccountId, organizationId: actor.organizationId, isActive: true, type: { in: data.type === "PURCHASE" ? ["SUPPLIER", "BOTH"] : ["CUSTOMER", "BOTH"] } } });
  if (!account) throw new CashError("Fatura türüne uygun aktif cari seçin.", 404);
  const ids = [...new Set(data.items.flatMap(i => i.productId ? [i.productId] : []))];
  if (ids.length && await tx.product.count({ where: { id: { in: ids }, organizationId: actor.organizationId, isActive: true } }) !== ids.length) throw new CashError("Kalemlerdeki ürünlerden biri bu işletmede aktif değil.", 404);
  if (data.expenseCategoryId && !await tx.financeCategory.findFirst({ where: { id: data.expenseCategoryId, organizationId: actor.organizationId, direction: "OUT", isActive: true } })) throw new CashError("Aktif gider kategorisi seçin.", 404);
  if (data.expenseId) {
    const expense = await tx.expense.findFirst({ where: { id: data.expenseId, organizationId: actor.organizationId, branchId: data.branchId, cancelledAt: null } });
    if (!expense || !expense.amount.eq(data.grandTotal) || (expense.currentAccountId && expense.currentAccountId !== data.currentAccountId)) throw new CashError("Giderin şube, cari ve toplamı faturayla eşleşmeli.", 409);
  }
  return account;
}
function persist(data: Input) {
  const { items, ...fields } = data;
  return { ...fields, items: { create: items } };
}
export async function createInvoice(request: NextRequest) {
  try {
    const actor = await currentActor(), body = await jsonBody(request);
    onlyFields(body, [...invoiceFields, "idempotencyKey", "supplierId"]);
    const supplierId = text(body.supplierId, "tedarikçi", 200);
    const key = keyInput(body.idempotencyKey), data = invoiceInput(body), hash = hashRequest(supplierId ? { data, supplierId } : data);
    const work = () => serialCashTransaction(prisma, async tx => {
      const previous = await tx.invoice.findFirst({ where: { organizationId: actor.organizationId, idempotencyKey: key, ...branchScope(actor) } });
      if (previous) { if (previous.requestHash !== hash) throw new CashError("İstek anahtarı farklı bir fatura için kullanılmış.", 409); return { invoice: previous, replayed: true }; }
      if (supplierId && (data.type !== "PURCHASE" || !await tx.supplier.findFirst({ where: { id: supplierId, organizationId: actor.organizationId, isActive: true, currentAccountId: data.currentAccountId }, select: { id: true } }))) throw new CashError("Aktif tedarikçi ile alış faturası carisi eşleşmeli.", 409);
      await validate(tx, actor, data);
      const invoice = await tx.invoice.create({ data: { ...persist(data), organizationId: actor.organizationId, idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      await writeAudit(tx, actor, "invoice.create", "Invoice", invoice.id, invoice.branchId, { number: invoice.number, total: invoice.grandTotal.toString() });
      return { invoice, replayed: false };
    });
    let result;
    try { result = await work(); } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; result = await work(); }
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return invoiceError(error); }
}
export async function getInvoice(_request: NextRequest, context: InvoiceContext) {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const invoice = await prisma.$transaction(async tx => {
      const result = await invoiceRecord(tx, actor, id);
      return { ...result, ...paymentTotals(result.grandTotal, result.allocations) };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ success: true, invoice });
  } catch (error) { return invoiceError(error); }
}
export async function updateInvoice(request: NextRequest, context: InvoiceContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, [...invoiceFields, "expectedVersion"]);
    const version = expenseVersion(body.expectedVersion);
    const invoice = await serialCashTransaction(prisma, async tx => {
      const saved = await invoiceRecord(tx, actor, id);
      if (saved.status !== "DRAFT" || saved.version !== version) throw new CashError("Yalnız güncel taslak düzenlenebilir.", 409);
      const data = invoiceInput(body); await validate(tx, actor, data);
      // Only draft line snapshots can be replaced. Issued/history records have no delete endpoint.
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id, organizationId: actor.organizationId } });
      const updated = await tx.invoice.update({ where: { id, version, status: "DRAFT" }, data: { ...persist(data), version: { increment: 1 } } });
      await writeAudit(tx, actor, "invoice.update", "Invoice", id, saved.branchId, { previousVersion: version, number: updated.number });
      return updated;
    });
    return NextResponse.json({ success: true, invoice });
  } catch (error) { return invoiceError(error); }
}
export async function issueInvoice(request: NextRequest, context: InvoiceContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["expectedVersion", "adoptExpenseReason"]);
    const version = expenseVersion(body.expectedVersion);
    const invoice = await serialCashTransaction(prisma, async tx => {
      const saved = await invoiceRecord(tx, actor, id);
      if (saved.status !== "DRAFT" || saved.version !== version) throw new CashError("Fatura kesinleştirilmiş, iptal edilmiş veya değişmiş.", 409);
      const data = invoiceInput({ ...saved, invoiceDate: saved.invoiceDate.toISOString(), dueDate: saved.dueDate?.toISOString(), discountValue: saved.discountValue.toString(), items: saved.items.map(i => ({ productId: i.productId, description: i.description, unit: i.unit, quantity: i.quantity.toString(), unitPrice: i.unitPrice.toString(), discountType: i.discountType, discountValue: i.discountValue.toString(), vatRate: i.vatRate.toString() })) });
      const account = await validate(tx, actor, data);
      if (data.grandTotal.lte(0) || !data.grandTotal.eq(saved.grandTotal) || saved.orderId) throw new CashError("Fatura toplamı veya kaynak bağlantısı doğrulanamadı.", 409);
      let expenseId = saved.expenseId;
      let entry;
      if (expenseId || saved.expenseCategoryId) {
        let expense = expenseId ? await tx.expense.findFirstOrThrow({ where: { id: expenseId, organizationId: actor.organizationId, branchId: saved.branchId } }) : null;
        if (!expense) {
          const sourceKey = `invoice:${id}:expense`;
          expense = await tx.expense.create({ data: { organizationId: actor.organizationId, branchId: saved.branchId, title: `Alış faturası: ${saved.number}`, categoryId: saved.expenseCategoryId!, amount: saved.grandTotal, expenseDate: saved.invoiceDate, dueDate: saved.dueDate, description: saved.description, reference: saved.number, currentAccountId: saved.currentAccountId, sourceKey, idempotencyKey: sourceKey, requestHash: hashRequest(sourceKey), createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
          await accrual(tx, actor, expense);
          await writeAudit(tx, actor, "expense.create", "Expense", expense.id, saved.branchId, { invoiceId: id });
        } else if (!expense.currentAccountId) {
          const reason = text(body.adoptExpenseReason, "carisiz gideri bağlama gerekçesi", 1000, true)!;
          if (await tx.payment.count({ where: { expenseId: expense.id } })) throw new CashError("Carisiz ve ödemeli gider bağlanamaz; geçmiş ödemeler düzeltilmelidir.", 409);
          expense = await tx.expense.update({ where: { id: expense.id, version: expense.version }, data: { currentAccountId: saved.currentAccountId, version: { increment: 1 } } });
          await accrual(tx, actor, expense);
          await writeAudit(tx, actor, "expense.invoice.adopt", "Expense", expense.id, expense.branchId, { invoiceId: id, reason });
        }
        expenseId = expense.id;
        entry = await tx.currentAccountEntry.findFirst({ where: { expenseId, organizationId: actor.organizationId, branchId: saved.branchId, currentAccountId: saved.currentAccountId, kind: "EXPENSE", direction: "CREDIT", amount: saved.grandTotal, reversals: { none: {} } } });
        if (!entry) throw new CashError("Gider tahakkuku bulunamadı.", 409);
      } else {
        const sourceKey = `invoice:${id}:accrual`;
        entry = await tx.currentAccountEntry.create({ data: { organizationId: actor.organizationId, branchId: saved.branchId, currentAccountId: saved.currentAccountId, kind: "INVOICE", direction: saved.type === "PURCHASE" ? "CREDIT" : "DEBIT", amount: saved.grandTotal, description: `${saved.type === "PURCHASE" ? "Alış" : "Satış"} faturası: ${saved.number}`, reference: saved.number, occurredAt: saved.invoiceDate, dueAt: saved.dueDate, sourceKey, idempotencyKey: sourceKey, requestHash: hashRequest(sourceKey), createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      }
      const updated = await tx.invoice.update({ where: { id, version, status: "DRAFT" }, data: { status: "ISSUED", issuedAt: new Date(), accrualEntryId: entry.id, expenseId, version: { increment: 1 }, snapshot: { organizationName: saved.organization.name, branchName: saved.branch.name, account: { name: account.name, code: account.code, address: account.address, phone: account.phone, email: account.email, taxOffice: account.taxOffice, taxNumber: account.taxNumber } } } });
      if (expenseId) for (const payment of await tx.payment.findMany({ where: { expenseId, organizationId: actor.organizationId, branchId: saved.branchId, ...await activePayments(tx) }, select: await paymentSelect(tx) })) await allocatePayment(tx, actor, updated, payment);
      await writeAudit(tx, actor, "invoice.issue", "Invoice", id, saved.branchId, { accrualEntryId: entry.id, expenseId });
      return updated;
    });
    return NextResponse.json({ success: true, invoice });
  } catch (error) { return invoiceError(error); }
}
export async function cancelInvoice(request: NextRequest, context: InvoiceContext) {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["expectedVersion", "reason"]);
    const version = expenseVersion(body.expectedVersion), reason = text(body.reason, "iptal gerekçesi", 1000, true)!;
    const invoice = await serialCashTransaction(prisma, async tx => {
      const saved = await invoiceRecord(tx, actor, id);
      if (saved.status === "CANCELLED") return saved;
      if (saved.version !== version) throw new CashError("Fatura değişmiş; güncel kaydı yükleyin.", 409);
      if (saved.allocations.some(a => !a.payment.cancelledAt) || (saved.status === "ISSUED" && saved.expenseId && await tx.payment.count({ where: { expenseId: saved.expenseId, ...await activePayments(tx) } }))) throw new CashError("Ödemesi bulunan fatura iptal edilemez.", 409);
      let reversalEntryId: string | null = null;
      if (saved.status === "ISSUED") {
        if (!saved.accrualEntryId) throw new CashError("Tahakkuk doğrulanamadı.", 409);
        const original = await tx.currentAccountEntry.findFirst({ where: { id: saved.accrualEntryId, organizationId: actor.organizationId, reversals: { none: {} } } });
        if (!original || !original.amount.eq(saved.grandTotal)) throw new CashError("Tahakkuk doğrulanamadı.", 409);
        if (saved.expenseId) {
          const expense = await tx.expense.findFirstOrThrow({ where: { id: saved.expenseId, organizationId: actor.organizationId } });
          await reverseAccrual(tx, actor, expense, reason);
          await tx.expense.update({ where: { id: expense.id }, data: { cancelledAt: new Date(), cancellationReason: reason, cancelledByUserId: actor.userId, version: { increment: 1 } } });
          const reverse = await tx.currentAccountEntry.findUniqueOrThrow({ where: { reversalOfId: original.id } }); reversalEntryId = reverse.id;
          await writeAudit(tx, actor, "expense.cancel", "Expense", expense.id, expense.branchId, { invoiceId: id, reason });
        } else {
          const sourceKey = `invoice:${id}:reverse`;
          const reverse = await tx.currentAccountEntry.create({ data: { organizationId: actor.organizationId, branchId: saved.branchId, currentAccountId: saved.currentAccountId, kind: "REVERSAL", direction: original.direction === "DEBIT" ? "CREDIT" : "DEBIT", amount: original.amount, description: `Fatura iptali ${saved.number}: ${reason}`, reference: saved.number, occurredAt: original.occurredAt > new Date() ? original.occurredAt : new Date(), reversalOfId: original.id, sourceKey, idempotencyKey: sourceKey, requestHash: hashRequest(sourceKey), createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } }); reversalEntryId = reverse.id;
        }
      }
      const updated = await tx.invoice.update({ where: { id, version }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason, reversalEntryId, version: { increment: 1 } } });
      await writeAudit(tx, actor, "invoice.cancel", "Invoice", id, saved.branchId, { reason, reversalEntryId }); return updated;
    });
    return NextResponse.json({ success: true, invoice });
  } catch (error) { return invoiceError(error); }
}
