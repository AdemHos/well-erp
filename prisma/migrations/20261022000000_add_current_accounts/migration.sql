-- Approved Current Accounts migration; additive schema changes only.
-- Existing data is retained. The new FinanceTransaction index scans that table.
BEGIN;

-- CreateEnum
CREATE TYPE "CurrentAccountType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "CurrentAccountDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "CurrentAccountEntryKind" AS ENUM ('OPENING', 'ADJUSTMENT', 'REVERSAL', 'CREDIT_SALE', 'CREDIT_PURCHASE', 'INVOICE', 'COLLECTION', 'PAYMENT');

-- CreateTable
CREATE TABLE "CurrentAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CurrentAccountType" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentAccountEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currentAccountId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "direction" "CurrentAccountDirection" NOT NULL,
    "kind" "CurrentAccountEntryKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdByProfileId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "financeTransactionId" TEXT,
    "sourceKey" TEXT,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "CurrentAccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrentAccount_organizationId_isActive_type_idx" ON "CurrentAccount"("organizationId", "isActive", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccount_id_organizationId_key" ON "CurrentAccount"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccount_organizationId_code_key" ON "CurrentAccount"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_reversalOfId_key" ON "CurrentAccountEntry"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_financeTransactionId_key" ON "CurrentAccountEntry"("financeTransactionId");

-- CreateIndex
CREATE INDEX "CurrentAccountEntry_organizationId_currentAccountId_occurre_idx" ON "CurrentAccountEntry"("organizationId", "currentAccountId", "occurredAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CurrentAccountEntry_organizationId_branchId_occurredAt_idx" ON "CurrentAccountEntry"("organizationId", "branchId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_id_organizationId_currentAccountId_bran_key" ON "CurrentAccountEntry"("id", "organizationId", "currentAccountId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_organizationId_idempotencyKey_key" ON "CurrentAccountEntry"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountEntry_organizationId_sourceKey_key" ON "CurrentAccountEntry"("organizationId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceTransaction_id_organizationId_branchId_key" ON "FinanceTransaction"("id", "organizationId", "branchId");

-- AddForeignKey
ALTER TABLE "CurrentAccount" ADD CONSTRAINT "CurrentAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_reversalOfId_organizationId_currentAcc_fkey" FOREIGN KEY ("reversalOfId", "organizationId", "currentAccountId", "branchId") REFERENCES "CurrentAccountEntry"("id", "organizationId", "currentAccountId", "branchId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_financeTransactionId_organizationId_br_fkey" FOREIGN KEY ("financeTransactionId", "organizationId", "branchId") REFERENCES "FinanceTransaction"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additional ledger invariants not expressible in the Prisma schema.
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_positive_amount" CHECK (amount > 0);
ALTER TABLE "CurrentAccountEntry" ADD CONSTRAINT "CurrentAccountEntry_reversal_kind" CHECK ((kind = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
ALTER TABLE "CurrentAccount" ADD CONSTRAINT "CurrentAccount_normalized_code" CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9._/-]*$');
CREATE UNIQUE INDEX "CurrentAccountEntry_one_opening_per_branch" ON "CurrentAccountEntry" ("organizationId", "currentAccountId", "branchId") WHERE kind = 'OPENING';

COMMIT;
