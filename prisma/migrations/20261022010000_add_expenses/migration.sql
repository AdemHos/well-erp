-- Approved Expense migration; backup restored and verified before deployment.
BEGIN;

-- AlterEnum
ALTER TYPE "FinanceSource" ADD VALUE 'EXPENSE_PAYMENT';

-- AlterEnum
ALTER TYPE "CurrentAccountEntryKind" ADD VALUE 'EXPENSE';

-- AlterTable
ALTER TABLE "CurrentAccountEntry" ADD COLUMN     "expenseId" TEXT;

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "reference" TEXT,
    "currentAccountId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByProfileId" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "financeTransactionId" TEXT NOT NULL,
    "currentAccountEntryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdByProfileId" TEXT,

    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_organizationId_branchId_expenseDate_idx" ON "Expense"("organizationId", "branchId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_organizationId_categoryId_idx" ON "Expense"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_dueDate_idx" ON "Expense"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_id_organizationId_branchId_key" ON "Expense"("id", "organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_idempotencyKey_key" ON "Expense"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_sourceKey_key" ON "Expense"("organizationId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_financeTransactionId_key" ON "ExpensePayment"("financeTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_currentAccountEntryId_key" ON "ExpensePayment"("currentAccountEntryId");

-- CreateIndex
CREATE INDEX "ExpensePayment_organizationId_expenseId_paidAt_idx" ON "ExpensePayment"("organizationId", "expenseId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_id_organizationId_branchId_key" ON "ExpensePayment"("id", "organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayment_organizationId_idempotencyKey_key" ON "ExpensePayment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCategory_id_organizationId_key" ON "FinanceCategory"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CurrentAccountEntry_expenseId_idx" ON "CurrentAccountEntry"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_id_organizationId_branchId_key" ON "CurrentAccountEntry"("id", "organizationId", "branchId");

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_expenseId_organizationId_branchId_fkey" FOREIGN KEY ("expenseId", "organizationId", "branchId") REFERENCES "Expense"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_organizationId_fkey" FOREIGN KEY ("categoryId", "organizationId") REFERENCES "FinanceCategory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_expenseId_organizationId_branchId_fkey" FOREIGN KEY ("expenseId", "organizationId", "branchId") REFERENCES "Expense"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_financeTransactionId_organizationId_branchI_fkey" FOREIGN KEY ("financeTransactionId", "organizationId", "branchId") REFERENCES "FinanceTransaction"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_currentAccountEntryId_organizationId_branch_fkey" FOREIGN KEY ("currentAccountEntryId", "organizationId", "branchId") REFERENCES "CurrentAccountEntry"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants beyond Prisma schema syntax.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_positive_amount" CHECK (amount > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_positive_version" CHECK (version > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cancellation_consistency" CHECK (("cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancellationReason" IS NULL) OR ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND length(btrim("cancellationReason")) > 0 AND "cancellationReason" IS NOT NULL));
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_positive_amount" CHECK (amount > 0);
COMMIT;
