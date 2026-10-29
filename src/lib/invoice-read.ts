import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedBranchIds, hasAllBranches, branchIdScope, branchScope } from "@/lib/permissions";
import { currentActor } from "@/lib/current-accounts-service";
import { CashError } from "@/lib/cash-management";
import { dateInput, pagination, text } from "@/lib/current-accounts";
import { invoiceError } from "@/lib/invoice-service";
import { todayInIstanbul } from "@/lib/expenses";

export async function invoiceOptions(request: NextRequest) {
  try {
    const actor = await currentActor(), q = text(request.nextUrl.searchParams.get("q"), "arama", 100);
    const branchId = text(request.nextUrl.searchParams.get("branchId"), "şube", 200);
    const [branches, accounts, products, categories, expenses] = await Promise.all([
      prisma.branch.findMany({ where: { AND: [{ organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.currentAccount.findMany({ where: { organizationId: actor.organizationId, isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, code: true, type: true }, orderBy: { name: "asc" }, take: 50 }),
      prisma.product.findMany({ where: { organizationId: actor.organizationId, isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, select: { id: true, name: true, price: true, costPrice: true, unit: true }, orderBy: { name: "asc" }, take: 50 }),
      prisma.financeCategory.findMany({ where: { organizationId: actor.organizationId, isActive: true, direction: "OUT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.expense.findMany({ where: { organizationId: actor.organizationId, ...branchScope(actor), ...(branchId ? { branchId } : {}), cancelledAt: null, invoice: null, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, title: true, amount: true, branchId: true, currentAccountId: true, reference: true }, orderBy: { expenseDate: "desc" }, take: 50 }),
    ]);
    return NextResponse.json({ branches, accounts, products, categories, expenses });
  } catch (error) { return invoiceError(error); }
}
export async function listInvoices(request: NextRequest) {
  try {
    const actor = await currentActor(), params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params), ids = allowedBranchIds(actor);
    const q = text(params.get("q"), "arama", 200), branchId = params.get("branchId"), status = params.get("status"), type = params.get("type"), paymentStatus = params.get("paymentStatus");
    if (branchId && !hasAllBranches(actor) && !ids.includes(branchId)) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
    if (status && !["DRAFT", "ISSUED", "CANCELLED"].includes(status)) throw new CashError("Geçersiz fatura durumu.");
    if (type && !["PURCHASE", "SALES"].includes(type)) throw new CashError("Geçersiz fatura türü.");
    if (paymentStatus && !["UNPAID", "PARTIALLY_PAID", "PAID"].includes(paymentStatus)) throw new CashError("Geçersiz ödeme durumu.");
    const start = dateInput(params.get("startDate")), end = dateInput(params.get("endDate"), true);
    if (start && end && start > end) throw new CashError("Geçersiz tarih aralığı.");
    const cte = Prisma.sql`WITH balances AS (
      SELECT i.*, a.name AS "currentAccountName", b.name AS "branchName", COALESCE(p.paid,0) AS paid,
      i."grandTotal"-COALESCE(p.paid,0) AS remaining,
      CASE WHEN COALESCE(p.paid,0)=0 THEN 'UNPAID' WHEN p.paid=i."grandTotal" THEN 'PAID' ELSE 'PARTIALLY_PAID' END AS "paymentStatus"
      FROM "Invoice" i JOIN "CurrentAccount" a ON a.id=i."currentAccountId" AND a."organizationId"=i."organizationId"
      JOIN "Branch" b ON b.id=i."branchId" AND b."organizationId"=i."organizationId"
      LEFT JOIN (SELECT "invoiceId", a."organizationId", SUM(a.amount) AS paid FROM "InvoicePaymentAllocation" a JOIN "ExpensePayment" ep ON ep.id=a."paymentId" AND ep."organizationId"=a."organizationId" WHERE a."organizationId"=${actor.organizationId} AND (to_jsonb(ep)->>'cancelledAt') IS NULL GROUP BY "invoiceId", a."organizationId") p ON p."invoiceId"=i.id AND p."organizationId"=i."organizationId"
      WHERE i."organizationId"=${actor.organizationId}
      AND ${hasAllBranches(actor) ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`i."branchId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`}
      ${branchId ? Prisma.sql`AND i."branchId"=${branchId}` : Prisma.empty}
      ${status ? Prisma.sql`AND i.status::text=${status}` : Prisma.empty}
      ${type ? Prisma.sql`AND i.type::text=${type}` : Prisma.empty}
      ${start ? Prisma.sql`AND i."invoiceDate">=${start}` : Prisma.empty}
      ${end ? Prisma.sql`AND i."invoiceDate"<=${end}` : Prisma.empty}
      ${q ? Prisma.sql`AND POSITION(lower(${q}) IN lower(concat_ws(' ',i.number,i.description,a.name,a.code)))>0` : Prisma.empty}
    ), filtered AS (SELECT * FROM balances WHERE TRUE ${paymentStatus ? Prisma.sql`AND "paymentStatus"=${paymentStatus}` : Prisma.empty})`;
    const result = await prisma.$transaction(async tx => {
      const [summary] = await tx.$queryRaw<{ count: bigint; purchaseTotal: string; salesTotal: string; payable: string; receivable: string; overdueAmount: string; overdueCount: bigint }[]>(Prisma.sql`${cte} SELECT COUNT(*) AS count,
        COALESCE(SUM("grandTotal") FILTER(WHERE status='ISSUED' AND type='PURCHASE'),0)::text AS "purchaseTotal",
        COALESCE(SUM("grandTotal") FILTER(WHERE status='ISSUED' AND type='SALES'),0)::text AS "salesTotal",
        COALESCE(SUM(remaining) FILTER(WHERE status='ISSUED' AND type='PURCHASE'),0)::text AS payable,
        COALESCE(SUM(remaining) FILTER(WHERE status='ISSUED' AND type='SALES'),0)::text AS receivable,
        COALESCE(SUM(remaining) FILTER(WHERE status='ISSUED' AND remaining>0 AND "dueDate"<${todayInIstanbul()}),0)::text AS "overdueAmount",
        COUNT(*) FILTER(WHERE status='ISSUED' AND remaining>0 AND "dueDate"<${todayInIstanbul()}) AS "overdueCount" FROM filtered`);
      const invoices = await tx.$queryRaw(Prisma.sql`${cte} SELECT id,number,type,status,"invoiceDate","dueDate","branchName","branchId","currentAccountName","currentAccountId","grandTotal"::text, paid::text AS "paidAmount", remaining::text AS "remainingAmount","paymentStatus",version FROM filtered ORDER BY "invoiceDate" DESC,"createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${skip}`);
      return { invoices, summary: { ...summary, count: Number(summary.count), overdueCount: Number(summary.overdueCount) }, pagination: { page, limit, total: Number(summary.count), totalPages: Math.ceil(Number(summary.count) / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ success: true, ...result });
  } catch (error) { return invoiceError(error); }
}
