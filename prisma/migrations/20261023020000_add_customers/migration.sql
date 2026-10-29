-- Local design approved; live application requires a fresh verified Neon backup and separate approval.
BEGIN;
-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerSnapshot" JSONB;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentAccountId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_currentAccountId_key" ON "Customer"("currentAccountId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_isActive_type_idx" ON "Customer"("organizationId", "isActive", "type");

-- CreateIndex
CREATE INDEX "Customer_organizationId_name_id_idx" ON "Customer"("organizationId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_currentAccountId_organizationId_key" ON "Customer"("currentAccountId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_code_key" ON "Customer"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_idempotencyKey_key" ON "Customer"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_organizationId_customerId_createdAt_idx" ON "Order"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_customerId_branchId_createdAt_idx" ON "Order"("organizationId", "customerId", "branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_normalized_code" CHECK (code=upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9._/-]*$');
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_name_nonempty" CHECK (length(btrim(name))>0);
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_version_positive" CHECK (version>0);
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tax_fields" CHECK (
 (type='INDIVIDUAL' AND "taxOffice" IS NULL AND "taxNumber" IS NULL)
 OR (type='CORPORATE' AND ("taxNumber" IS NULL OR "taxNumber" ~ '^[0-9]{10}$'))
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_customer_snapshot" CHECK (
 ("customerId" IS NULL AND "customerSnapshot" IS NULL)
 OR ("customerId" IS NOT NULL AND "customerSnapshot" IS NOT NULL
 AND jsonb_typeof("customerSnapshot")='object' AND "customerSnapshot" ?& ARRAY['name','code','type']
 AND jsonb_typeof("customerSnapshot"->'name')='string'
 AND jsonb_typeof("customerSnapshot"->'code')='string'
 AND "customerSnapshot"->>'type' IN ('INDIVIDUAL','CORPORATE'))
);
COMMIT;
