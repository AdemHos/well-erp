import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedBranchIds, hasAllBranches, type BranchScope } from "@/lib/permissions";
import { CashError } from "@/lib/cash-management";
import { csvCell, dateInput, entryKinds, pagination, text } from "@/lib/current-accounts";
import { type AccountContext, currentActor, currentCard, currentError } from "@/lib/current-accounts-service";

type StatementRow = {
  invoiceNumber?: string | null; invoiceId?: string | null;
  id: string; branchId: string; branchName: string; kind: keyof typeof entryKinds;
  direction: "DEBIT" | "CREDIT"; amount: string; balance: string;
  description: string | null; reference: string | null; occurredAt: Date;
  createdAt: Date; createdByName: string; reversalOfId: string | null;
  reversed: boolean; canReverse: boolean;
};
type StatementTotals = { total: bigint; debit: string; credit: string; opening: string; balance: string; lifetimeDebit: string; lifetimeCredit: string };

function branchSql(actor: BranchScope, branchId: string | null) {
  const ids = allowedBranchIds(actor);
  if (branchId && !hasAllBranches(actor) && !ids.includes(branchId)) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
  const scope = hasAllBranches(actor) ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`e."branchId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  return Prisma.sql`${scope} ${branchId ? Prisma.sql`AND e."branchId" = ${branchId}` : Prisma.empty}`;
}

export async function accountStatement(request: NextRequest, context: AccountContext, csv = false) {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params);
    const start = dateInput(params.get("startDate")), end = dateInput(params.get("endDate"), true);
    if (start && end && start > end) throw new CashError("Başlangıç tarihi bitişten sonra olamaz.");
    const q = text(params.get("q"), "arama", 200);
    const sort = params.get("sort") ?? "asc";
    if (!["asc", "desc"].includes(sort)) throw new CashError("Geçersiz sıralama.");
    const branch = branchSql(actor, params.get("branchId"));
    // Compute historical balances BEFORE searching, slicing dates or paginating.
    const ledgerFor = (invoiceReady: boolean) => Prisma.sql`
      WITH ledger AS (
        SELECT e.*, ${invoiceReady ? Prisma.sql`i.number` : Prisma.sql`NULL::text`} AS "invoiceNumber", ${invoiceReady ? Prisma.sql`i.id` : Prisma.sql`NULL::text`} AS "invoiceId", b.name AS "branchName", COALESCE(p.name, u.name, 'Kullanıcı') AS "createdByName",
          SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount ELSE -e.amount END)
            OVER (ORDER BY e."occurredAt", e."createdAt", e.id ROWS UNBOUNDED PRECEDING) AS "runningBalance",
          EXISTS (SELECT 1 FROM "CurrentAccountEntry" r WHERE r."reversalOfId" = e.id) AS reversed
        FROM "CurrentAccountEntry" e
        JOIN "Branch" b ON b.id = e."branchId" AND b."organizationId" = e."organizationId"
        JOIN "User" u ON u.id = e."createdByUserId"
        LEFT JOIN "StaffProfile" p ON p.id = e."createdByProfileId" AND p."organizationId" = e."organizationId"
        ${invoiceReady ? Prisma.sql`LEFT JOIN "Invoice" i ON i."organizationId"=e."organizationId" AND i."branchId"=e."branchId" AND i."currentAccountId"=e."currentAccountId" AND i.status<>'DRAFT' AND (i."expenseId"=e."expenseId" OR i."accrualEntryId"=e.id OR i."reversalEntryId"=e.id OR EXISTS (SELECT 1 FROM "InvoicePaymentAllocation" pa JOIN "ExpensePayment" ep ON ep.id=pa."paymentId" AND ep."organizationId"=pa."organizationId" AND ep."branchId"=pa."branchId" WHERE pa."invoiceId"=i.id AND pa."organizationId"=i."organizationId" AND (ep."currentAccountEntryId"=e.id OR to_jsonb(ep)->>'reversalCurrentAccountEntryId'=e.id)))` : Prisma.empty}
        WHERE e."organizationId" = ${actor.organizationId} AND e."currentAccountId" = ${id} AND ${branch}
      ), filtered AS (
        SELECT * FROM ledger WHERE TRUE
          ${start ? Prisma.sql`AND "occurredAt" >= ${start}` : Prisma.empty}
          ${end ? Prisma.sql`AND "occurredAt" <= ${end}` : Prisma.empty}
          ${q ? Prisma.sql`AND POSITION(lower(${q}) IN lower(concat_ws(' ', description, reference, "invoiceNumber", kind::text, "branchName", "createdByName"))) > 0` : Prisma.empty}
      )`;
    const result = await prisma.$transaction(async tx => {
      const account = await currentCard(tx, actor, id);
      const [schema] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."Invoice"') IS NOT NULL AS ready`;
      const ledger = ledgerFor(!!schema?.ready);
      const [totals] = await tx.$queryRaw<StatementTotals[]>(Prisma.sql`${ledger}
        SELECT COUNT(*) AS total,
          COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text AS debit,
          COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text AS credit,
          (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0)::text FROM ledger ${start ? Prisma.sql`WHERE "occurredAt" < ${start}` : Prisma.sql`WHERE FALSE`}) AS opening,
          (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0)::text FROM ledger) AS balance,
          (SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text FROM ledger) AS "lifetimeDebit",
          (SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text FROM ledger) AS "lifetimeCredit"
        FROM filtered`);
      const order = sort === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const entries = await tx.$queryRaw<StatementRow[]>(Prisma.sql`${ledger}
        SELECT id, "branchId", "branchName", kind, direction, amount::text, "runningBalance"::text AS balance,
          description, reference, "invoiceNumber", "invoiceId", "occurredAt", "createdAt", "createdByName", "reversalOfId", reversed,
          (kind IN ('OPENING', 'ADJUSTMENT') AND "financeTransactionId" IS NULL AND "sourceKey" IS NULL AND NOT reversed) AS "canReverse"
        FROM filtered ORDER BY "occurredAt" ${order}, "createdAt" ${order}, id ${order}
        ${csv ? Prisma.empty : Prisma.sql`LIMIT ${limit} OFFSET ${skip}`}`);
      return { account, entries, summary: { debit: totals.debit, credit: totals.credit, opening: totals.opening, balance: totals.balance, totalDebit: totals.lifetimeDebit, totalCredit: totals.lifetimeCredit }, pagination: { page, limit, total: Number(totals.total), totalPages: Math.ceil(Number(totals.total) / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    if (!csv) return NextResponse.json({ success: true, ...result });
    const day = (date: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "medium" }).format(date);
    const rows: unknown[][] = [
      ["Cari kodu", result.account.code, "Cari adı", result.account.name],
      ["Kapsam", "Yalnızca yetkili şubeler", "Tarih öncesi devir", result.summary.opening],
      ["Tarih", "İşlem türü", "Şube", "Açıklama", "Referans", "Fatura no", "Borç", "Alacak", "İşlem sonrası bakiye", "Oluşturan", "Ters kayıt bağlantısı"],
      ...result.entries.map(e => [day(e.occurredAt), entryKinds[e.kind], e.branchName, e.description, e.reference, e.invoiceNumber, e.direction === "DEBIT" ? e.amount : "", e.direction === "CREDIT" ? e.amount : "", e.balance, e.createdByName, e.reversalOfId]),
    ];
    const content = "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
    return new NextResponse(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cari-ekstre.csv"', "Cache-Control": "no-store" } });
  } catch (error) { return currentError(error); }
}
