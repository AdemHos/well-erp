import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedBranchIds, hasAllBranches } from "@/lib/permissions";
import { paymentActor, paymentError } from "@/lib/payment-operations";

export async function paymentOverview() {
  try {
    const actor = await paymentActor(), ids = allowedBranchIds(actor);
    const scope = hasAllBranches(actor) ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`"branchId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
    const [overview] = await prisma.$queryRaw<{ payable: string; receivable: string; paid: string; collected: string }[]>(Prisma.sql`
      WITH active_payments AS (
        SELECT * FROM "ExpensePayment" WHERE "organizationId"=${actor.organizationId} AND "cancelledAt" IS NULL AND ${scope}
      ), invoice_open AS (
        SELECT i.id, i.type, i."grandTotal"-COALESCE((SELECT SUM(a.amount) FROM "InvoicePaymentAllocation" a JOIN active_payments p ON p.id=a."paymentId" AND p."organizationId"=a."organizationId" WHERE a."invoiceId"=i.id),0) AS remaining
        FROM "Invoice" i WHERE i."organizationId"=${actor.organizationId} AND status='ISSUED' AND ${scope}
      ), expense_open AS (
        SELECT e.amount-COALESCE((SELECT SUM(p.amount) FROM active_payments p WHERE p."expenseId"=e.id),0) AS remaining
        FROM "Expense" e WHERE e."organizationId"=${actor.organizationId} AND e."cancelledAt" IS NULL AND ${scope}
          AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."expenseId"=e.id AND i."organizationId"=e."organizationId" AND i.status='ISSUED')
      )
      SELECT ((SELECT COALESCE(SUM(remaining),0) FROM invoice_open WHERE type='PURCHASE')+(SELECT COALESCE(SUM(remaining),0) FROM expense_open))::text AS payable,
        (SELECT COALESCE(SUM(remaining),0)::text FROM invoice_open WHERE type='SALES') AS receivable,
        (SELECT COALESCE(SUM(amount),0)::text FROM active_payments WHERE type::text IN ('SUPPLIER_PAYMENT','EXPENSE_PAYMENT','PURCHASE_INVOICE_PAYMENT')) AS paid,
        (SELECT COALESCE(SUM(amount),0)::text FROM active_payments WHERE type::text IN ('CUSTOMER_COLLECTION','SALES_INVOICE_COLLECTION')) AS collected
    `);
    return NextResponse.json({ overview });
  } catch (error) { return paymentError(error); }
}
