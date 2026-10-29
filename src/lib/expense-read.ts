import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedBranchIds, hasAllBranches } from "@/lib/permissions";
import { currentActor } from "@/lib/current-accounts-service";
import { CashError } from "@/lib/cash-management";
import { dateInput, pagination, text } from "@/lib/current-accounts";
import { expenseError } from "@/lib/expense-service";
import { todayInIstanbul } from "@/lib/expenses";

type Summary = { count: bigint; totalAmount: string; paidAmount: string; remainingAmount: string; overdueAmount: string; overdueCount: bigint };
export async function listExpenses(request: NextRequest) {
  try {
    const actor = await currentActor(), params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params);
    const q = text(params.get("q"), "arama", 200), categoryId = text(params.get("categoryId"), "kategori", 200);
    const branchId = params.get("branchId"), ids = allowedBranchIds(actor);
    if (branchId && !hasAllBranches(actor) && !ids.includes(branchId)) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
    const start = dateInput(params.get("startDate")), end = dateInput(params.get("endDate"), true);
    if (start && end && start > end) throw new CashError("Geçersiz tarih aralığı.");
    const status = params.get("status"), cancelled = params.get("cancelled") ?? "exclude";
    if (status && !["UNPAID", "PARTIALLY_PAID", "PAID"].includes(status)) throw new CashError("Geçersiz ödeme durumu.");
    if (!["exclude", "include", "only"].includes(cancelled)) throw new CashError("Geçersiz iptal filtresi.");
    const scope = hasAllBranches(actor) ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`e."branchId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
    const cte = Prisma.sql`
      WITH balances AS (
        SELECT e.*, b.name AS "branchName", c.name AS "categoryName", a.name AS "currentAccountName",
          COALESCE(p.paid, 0) AS paid, e.amount - COALESCE(p.paid, 0) AS remaining,
          CASE WHEN COALESCE(p.paid,0) = 0 THEN 'UNPAID' WHEN p.paid = e.amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END AS "paymentStatus"
        FROM "Expense" e
        JOIN "Branch" b ON b.id = e."branchId" AND b."organizationId" = e."organizationId"
        JOIN "FinanceCategory" c ON c.id = e."categoryId" AND c."organizationId" = e."organizationId"
        LEFT JOIN "CurrentAccount" a ON a.id = e."currentAccountId" AND a."organizationId" = e."organizationId"
        LEFT JOIN (SELECT "expenseId", "organizationId", SUM(amount) AS paid FROM "ExpensePayment" WHERE "organizationId" = ${actor.organizationId} AND (to_jsonb("ExpensePayment")->>'cancelledAt') IS NULL GROUP BY "expenseId", "organizationId") p
          ON p."expenseId" = e.id AND p."organizationId" = e."organizationId"
        WHERE e."organizationId" = ${actor.organizationId} AND ${scope}
        ${branchId ? Prisma.sql`AND e."branchId" = ${branchId}` : Prisma.empty}
        ${categoryId ? Prisma.sql`AND e."categoryId" = ${categoryId}` : Prisma.empty}
        ${start ? Prisma.sql`AND e."expenseDate" >= ${start}` : Prisma.empty}
        ${end ? Prisma.sql`AND e."expenseDate" <= ${end}` : Prisma.empty}
        ${q ? Prisma.sql`AND POSITION(lower(${q}) IN lower(concat_ws(' ', e.title, e.description, e.reference, a.name, c.name))) > 0` : Prisma.empty}
      ), filtered AS (SELECT * FROM balances WHERE TRUE
        ${status ? Prisma.sql`AND "paymentStatus" = ${status}` : Prisma.empty}
        ${cancelled === "exclude" ? Prisma.sql`AND "cancelledAt" IS NULL` : cancelled === "only" ? Prisma.sql`AND "cancelledAt" IS NOT NULL` : Prisma.empty}
      )`;
    const result = await prisma.$transaction(async tx => {
      const [summary] = await tx.$queryRaw<Summary[]>(Prisma.sql`${cte}
        SELECT COUNT(*) AS count,
          COALESCE(SUM(amount) FILTER (WHERE "cancelledAt" IS NULL),0)::text AS "totalAmount",
          COALESCE(SUM(paid) FILTER (WHERE "cancelledAt" IS NULL),0)::text AS "paidAmount",
          COALESCE(SUM(remaining) FILTER (WHERE "cancelledAt" IS NULL),0)::text AS "remainingAmount",
          COALESCE(SUM(remaining) FILTER (WHERE "cancelledAt" IS NULL AND remaining > 0 AND "dueDate" < ${todayInIstanbul()}),0)::text AS "overdueAmount",
          COUNT(*) FILTER (WHERE "cancelledAt" IS NULL AND remaining > 0 AND "dueDate" < ${todayInIstanbul()}) AS "overdueCount"
        FROM filtered`);
      const expenses = await tx.$queryRaw(Prisma.sql`${cte}
        SELECT id, title, "branchId", "branchName", "categoryId", "categoryName", "currentAccountId", "currentAccountName",
          "expenseDate", "dueDate", description, reference, "cancelledAt", version, amount::text,
          paid::text AS "paidAmount", remaining::text AS "remainingAmount", "paymentStatus"
        FROM filtered ORDER BY "expenseDate" DESC, "createdAt" DESC, id DESC LIMIT ${limit} OFFSET ${skip}`);
      return { expenses, summary: { ...summary, count: Number(summary.count), overdueCount: Number(summary.overdueCount) }, pagination: { page, limit, total: Number(summary.count), totalPages: Math.ceil(Number(summary.count) / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ success: true, ...result });
  } catch (error) { return expenseError(error); }
}
