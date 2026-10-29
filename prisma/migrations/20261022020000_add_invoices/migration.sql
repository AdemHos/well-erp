-- CreateEnum
-- Local design approved. Live execution requires a fresh verified backup and separate approval.
CREATE TYPE "InvoiceType" AS ENUM ('PURCHASE', 'SALES');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoicePriceMode" AS ENUM ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE');

-- AlterTable
ALTER TABLE "ExpensePayment" ALTER COLUMN "expenseId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "currentAccountId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT NOT NULL,
    "numberKey" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "description" TEXT,
    "priceMode" "InvoicePriceMode" NOT NULL,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(14,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "lineDiscountTotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "netTotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "expenseId" TEXT,
    "expenseCategoryId" TEXT,
    "orderId" TEXT,
    "accrualEntryId" TEXT,
    "reversalEntryId" TEXT,
    "snapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByProfileId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "generalDiscountShare" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePaymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_expenseId_key" ON "Invoice"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_accrualEntryId_key" ON "Invoice"("accrualEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reversalEntryId_key" ON "Invoice"("reversalEntryId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_branchId_invoiceDate_idx" ON "Invoice"("organizationId", "branchId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_type_idx" ON "Invoice"("organizationId", "status", "type");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_dueDate_idx" ON "Invoice"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_expenseId_organizationId_branchId_key" ON "Invoice"("expenseId", "organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_organizationId_branchId_key" ON "Invoice"("orderId", "organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_accrualEntryId_organizationId_currentAccountId_bran_key" ON "Invoice"("accrualEntryId", "organizationId", "currentAccountId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reversalEntryId_organizationId_currentAccountId_bra_key" ON "Invoice"("reversalEntryId", "organizationId", "currentAccountId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_organizationId_branchId_key" ON "Invoice"("id", "organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_idempotencyKey_key" ON "Invoice"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_position_key" ON "InvoiceItem"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "InvoicePaymentAllocation_paymentId_idx" ON "InvoicePaymentAllocation"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePaymentAllocation_invoiceId_paymentId_key" ON "InvoicePaymentAllocation"("invoiceId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_organizationId_key" ON "Product"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_organizationId_branchId_key" ON "Order"("id", "organizationId", "branchId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_expenseId_organizationId_branchId_fkey" FOREIGN KEY ("expenseId", "organizationId", "branchId") REFERENCES "Expense"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_organizationId_branchId_fkey" FOREIGN KEY ("orderId", "organizationId", "branchId") REFERENCES "Order"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accrualEntryId_organizationId_currentAccountId_bra_fkey" FOREIGN KEY ("accrualEntryId", "organizationId", "currentAccountId", "branchId") REFERENCES "CurrentAccountEntry"("id", "organizationId", "currentAccountId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_reversalEntryId_organizationId_currentAccountId_br_fkey" FOREIGN KEY ("reversalEntryId", "organizationId", "currentAccountId", "branchId") REFERENCES "CurrentAccountEntry"("id", "organizationId", "currentAccountId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_organizationId_branchId_fkey" FOREIGN KEY ("invoiceId", "organizationId", "branchId") REFERENCES "Invoice"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_invoiceId_organizationId_branchId_fkey" FOREIGN KEY ("invoiceId", "organizationId", "branchId") REFERENCES "Invoice"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_paymentId_organizationId_branchId_fkey" FOREIGN KEY ("paymentId", "organizationId", "branchId") REFERENCES "ExpensePayment"("id", "organizationId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- External supplier numbers are unique per supplier; own sales numbers per organization.
CREATE UNIQUE INDEX "Invoice_sales_number_unique" ON "Invoice" ("organizationId", "numberKey") WHERE type = 'SALES';
CREATE UNIQUE INDEX "Invoice_purchase_number_unique" ON "Invoice" ("organizationId", "currentAccountId", "numberKey") WHERE type = 'PURCHASE';
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals_check" CHECK (
 currency='TRY' AND length(trim("numberKey"))>0 AND version>0 AND "discountValue">=0
 AND subtotal>=0 AND "lineDiscountTotal">=0 AND "discountAmount">=0 AND "netTotal">=0 AND "taxTotal">=0
 AND "grandTotal"="netTotal"+"taxTotal" AND ("dueDate" IS NULL OR "dueDate">="invoiceDate")
 AND (type='PURCHASE' OR ("expenseId" IS NULL AND "expenseCategoryId" IS NULL))
 AND (status<>'ISSUED' OR ("accrualEntryId" IS NOT NULL AND "issuedAt" IS NOT NULL AND "grandTotal">0))
 AND (status<>'DRAFT' OR ("accrualEntryId" IS NULL AND "issuedAt" IS NULL AND "reversalEntryId" IS NULL))
 AND (status<>'CANCELLED' OR ("cancelledAt" IS NOT NULL AND length(trim("cancellationReason"))>0)));
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_values_check" CHECK (
 quantity>0 AND "unitPrice">=0 AND "discountValue">=0 AND "discountAmount">=0 AND "generalDiscountShare">=0
 AND "vatRate">=0 AND "vatRate"<=100 AND "netAmount">=0 AND "taxAmount">=0 AND total="netAmount"+"taxAmount" AND position>=0);
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_amount_check" CHECK (amount>0);
