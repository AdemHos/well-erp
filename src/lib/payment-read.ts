import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { branchScope, branchIdScope } from "@/lib/permissions";
import { dateInput, pagination, text } from "@/lib/current-accounts";
import { paymentActor, paymentError } from "@/lib/payment-operations";
import { CashError } from "@/lib/cash-management";
import { paymentTypes, type PaymentKind } from "@/lib/payments";

const details = {
  branch: { select: { id: true, name: true } }, currentAccount: { select: { id: true, name: true } },
  expense: { select: { id: true, title: true } },
  allocations: { include: { invoice: { select: { id: true, number: true } } } },
  financeTransaction: { include: { account: { select: { id: true, name: true, type: true } } } },
  createdBy: { select: { name: true } }, createdByProfile: { select: { name: true } },
  cancelledBy: { select: { name: true } }, cancelledByProfile: { select: { name: true } },
} satisfies Prisma.PaymentInclude;

export async function listPayments(request: NextRequest) {
  try {
    const actor = await paymentActor(), p = request.nextUrl.searchParams, { page, limit, skip } = pagination(p);
    const type = p.get("type"), status = p.get("status") ?? "active";
    if (type && !Object.hasOwn(paymentTypes, type)) throw new CashError("Geçersiz işlem türü.");
    if (!["active", "cancelled", "all"].includes(status)) throw new CashError("Geçersiz durum.");
    const start = dateInput(p.get("startDate")), end = dateInput(p.get("endDate"), true);
    if (start && end && start > end) throw new CashError("Geçersiz tarih aralığı.");
    const q = text(p.get("q"), "referans", 100), branchId = p.get("branchId"), accountId = p.get("accountId"), currentAccountId = p.get("currentAccountId"), expenseId = p.get("expenseId"), invoiceId = p.get("invoiceId");
    const where: Prisma.PaymentWhereInput = { organizationId: actor.organizationId, AND: [branchScope(actor), ...(branchId ? [{ branchId }] : [])], ...(type ? { type: type as PaymentKind } : {}), ...(status === "all" ? {} : { cancelledAt: status === "active" ? null : { not: null } }), ...(accountId ? { financeTransaction: { accountId } } : {}), ...(currentAccountId ? { currentAccountId } : {}), ...(expenseId ? { expenseId } : {}), ...(invoiceId ? { allocations: { some: { invoiceId } } } : {}), ...(q ? { reference: { contains: q, mode: "insensitive" } } : {}), paidAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } };
    const result = await prisma.$transaction(async tx => {
      const payments = await tx.payment.findMany({ where, include: details, orderBy: [{ paidAt: "desc" }, { id: "desc" }], skip, take: limit });
      const count = await tx.payment.count({ where });
      const totals = await tx.payment.groupBy({ by: ["type"], where: { ...where, cancelledAt: null }, _sum: { amount: true } });
      const incoming = ["CUSTOMER_COLLECTION", "SALES_INVOICE_COLLECTION"];
      const sum = (collection: boolean) => totals.filter(g => incoming.includes(g.type) === collection).reduce((n, g) => n.plus(g._sum.amount ?? 0), new Prisma.Decimal(0)).toString();
      return { payments, summary: { count, collections: status === "cancelled" ? "0" : sum(true), payments: status === "cancelled" ? "0" : sum(false) }, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result);
  } catch (error) { return paymentError(error); }
}
export async function getPayment(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await paymentActor(), { id } = await context.params;
    const payment = await prisma.payment.findFirst({ where: { id, organizationId: actor.organizationId, ...branchScope(actor) }, include: details });
    if (!payment) throw new CashError("Ödeme bulunamadı.", 404);
    return NextResponse.json({ payment });
  } catch (error) { return paymentError(error); }
}
export async function paymentOptions() {
  try {
    const actor = await paymentActor();
    const [branches, accounts, cards, expenses, invoices, organization] = await Promise.all([
      prisma.branch.findMany({ where: { organizationId: actor.organizationId, ...branchIdScope(actor) }, select: { id: true, name: true } }),
      prisma.financeAccount.findMany({ where: { organizationId: actor.organizationId, ...branchScope(actor), type: { in: ["CASH", "BANK"] } }, select: { id: true, name: true, branchId: true, isActive: true } }),
      prisma.currentAccount.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true, code: true, type: true, isActive: true } }),
      prisma.expense.findMany({ where: { organizationId: actor.organizationId, ...branchScope(actor), cancelledAt: null }, select: { id: true, title: true, branchId: true, currentAccountId: true, amount: true, payments: { where: { cancelledAt: null }, select: { amount: true } } } }),
      prisma.invoice.findMany({ where: { organizationId: actor.organizationId, ...branchScope(actor), status: "ISSUED", orderId: null }, select: { id: true, number: true, type: true, branchId: true, currentAccountId: true, grandTotal: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } } }),
      prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
    ]);
    return NextResponse.json({ organization, branches, accounts, cards, expenses: expenses.map(e => ({ ...e, payments: undefined, remaining: e.amount.minus(e.payments.reduce((n, p) => n.plus(p.amount), new Prisma.Decimal(0))).toString() })), invoices: invoices.map(i => ({ ...i, allocations: undefined, remaining: i.grandTotal.minus(i.allocations.reduce((n, a) => n.plus(a.amount), new Prisma.Decimal(0))).toString() })) });
  } catch (error) { return paymentError(error); }
}
