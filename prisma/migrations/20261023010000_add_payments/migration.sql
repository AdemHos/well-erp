BEGIN;
-- LOCAL ARTIFACT ONLY. Neon execution requires a NEW verified backup and separate approval.
-- Metadata-only additions and validated historical linkage; no cash/ledger history is rewritten.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM "ExpensePayment" p
  LEFT JOIN "Expense" e ON e.id=p."expenseId" AND e."organizationId"=p."organizationId" AND e."branchId"=p."branchId"
  LEFT JOIN "FinanceTransaction" f ON f.id=p."financeTransactionId" AND f."organizationId"=p."organizationId" AND f."branchId"=p."branchId"
  LEFT JOIN "CurrentAccountEntry" c ON c.id=p."currentAccountEntryId" AND c."organizationId"=p."organizationId" AND c."branchId"=p."branchId"
  WHERE e.id IS NULL OR f.id IS NULL OR f.source::text<>'EXPENSE_PAYMENT' OR f.direction::text<>'OUT' OR f.amount<>p.amount OR f."orderId" IS NOT NULL
  OR (e."currentAccountId" IS NULL) <> (p."currentAccountEntryId" IS NULL)
  OR (p."currentAccountEntryId" IS NOT NULL AND (c.id IS NULL OR c."currentAccountId"<>e."currentAccountId" OR c."financeTransactionId"<>f.id OR c.amount<>p.amount OR c.direction::text<>'DEBIT' OR c.kind::text<>'PAYMENT'))
 ) THEN RAISE EXCEPTION 'Legacy payment linkage inconsistent; migration stopped'; END IF;
END $$;
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CUSTOMER_COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE_PAYMENT', 'PURCHASE_INVOICE_PAYMENT', 'SALES_INVOICE_COLLECTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinanceSource" ADD VALUE 'PAYMENT';
ALTER TYPE "FinanceSource" ADD VALUE 'PAYMENT_REVERSAL';

-- AlterTable
ALTER TABLE "ExpensePayment" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByProfileId" TEXT,
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "currentAccountId" TEXT,
ADD COLUMN     "reversalCurrentAccountEntryId" TEXT,
ADD COLUMN     "reversalFinanceTransactionId" TEXT,
ADD COLUMN     "type" "PaymentType" NOT NULL DEFAULT 'EXPENSE_PAYMENT';

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_reversalFinanceTransactionId_key" ON "ExpensePayment"("reversalFinanceTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_reversalCurrentAccountEntryId_key" ON "ExpensePayment"("reversalCurrentAccountEntryId");

-- CreateIndex
CREATE INDEX "ExpensePayment_organizationId_branchId_paidAt_idx" ON "ExpensePayment"("organizationId", "branchId", "paidAt");

-- CreateIndex
CREATE INDEX "ExpensePayment_organizationId_type_cancelledAt_idx" ON "ExpensePayment"("organizationId", "type", "cancelledAt");

-- CreateIndex
CREATE INDEX "ExpensePayment_organizationId_currentAccountId_paidAt_idx" ON "ExpensePayment"("organizationId", "currentAccountId", "paidAt");

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_cancelledByProfileId_organizationId_fkey" FOREIGN KEY ("cancelledByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_reversalFinanceTransactionId_organizationId_fkey" FOREIGN KEY ("reversalFinanceTransactionId", "organizationId", "branchId") REFERENCES "FinanceTransaction"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_reversalCurrentAccountEntryId_organizationI_fkey" FOREIGN KEY ("reversalCurrentAccountEntryId", "organizationId", "branchId") REFERENCES "CurrentAccountEntry"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill only the new metadata field; original payment/finance/ledger IDs and values survive.
UPDATE "ExpensePayment" p SET "currentAccountId"=e."currentAccountId" FROM "Expense" e
 WHERE e.id=p."expenseId" AND e."organizationId"=p."organizationId" AND e."branchId"=p."branchId";
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "Payment_cancellation_complete" CHECK (
 ("cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancelledByProfileId" IS NULL AND "cancellationReason" IS NULL AND "reversalFinanceTransactionId" IS NULL AND "reversalCurrentAccountEntryId" IS NULL)
 OR ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND length(trim("cancellationReason"))>0 AND "cancellationReason" IS NOT NULL AND "reversalFinanceTransactionId" IS NOT NULL AND (("currentAccountEntryId" IS NULL AND "reversalCurrentAccountEntryId" IS NULL) OR ("currentAccountEntryId" IS NOT NULL AND "reversalCurrentAccountEntryId" IS NOT NULL)))
);
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "Payment_current_link" CHECK (("currentAccountId" IS NULL)=("currentAccountEntryId" IS NULL));
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "Payment_type_document" CHECK (
 (type::text='EXPENSE_PAYMENT' AND "expenseId" IS NOT NULL)
 OR (type::text IN ('CUSTOMER_COLLECTION','SUPPLIER_PAYMENT','SALES_INVOICE_COLLECTION') AND "expenseId" IS NULL AND "currentAccountId" IS NOT NULL)
 OR (type::text='PURCHASE_INVOICE_PAYMENT' AND "currentAccountId" IS NOT NULL)
);

COMMIT;
