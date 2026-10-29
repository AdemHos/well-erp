-- Additive management settings; requires verified Neon backup and separate deployment approval.
ALTER TABLE "Organization" ADD COLUMN "legalName" VARCHAR(160);
ALTER TABLE "Organization" ADD COLUMN "businessType" VARCHAR(60);
ALTER TABLE "Organization" ADD COLUMN "phone" VARCHAR(30);
ALTER TABLE "Organization" ADD COLUMN "email" VARCHAR(254);
ALTER TABLE "Organization" ADD COLUMN "website" VARCHAR(500);
ALTER TABLE "Organization" ADD COLUMN "address" VARCHAR(500);
ALTER TABLE "Organization" ADD COLUMN "city" VARCHAR(80);
ALTER TABLE "Organization" ADD COLUMN "district" VARCHAR(80);
ALTER TABLE "Organization" ADD COLUMN "taxOffice" VARCHAR(120);
ALTER TABLE "Organization" ADD COLUMN "taxNumber" VARCHAR(11);
ALTER TABLE "Organization" ADD COLUMN "logoUrl" VARCHAR(500);
ALTER TABLE "Order" ADD COLUMN "businessSnapshot" JSONB;
ALTER TABLE "BranchPrinterSetting" ADD COLUMN "showOrganization" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "showBranch" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "BranchSettings" (
 "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "branchId" TEXT NOT NULL,
 "defaultPaymentMethod" TEXT NOT NULL DEFAULT 'CASH',
 "discountRoles" TEXT[] NOT NULL DEFAULT ARRAY['OWNER','ADMIN','MANAGER','CASHIER']::TEXT[],
 "maxDiscountPercent" INTEGER NOT NULL DEFAULT 100,
 "refundRoles" TEXT[] NOT NULL DEFAULT ARRAY['OWNER','ADMIN','MANAGER']::TEXT[],
 "refundReasonRequired" BOOLEAN NOT NULL DEFAULT false,
 "customerSelection" TEXT NOT NULL DEFAULT 'OPTIONAL',
 "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
 "criticalStockEnabled" BOOLEAN NOT NULL DEFAULT true,
 "defaultCriticalLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
 "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
 "waiterNotification" BOOLEAN NOT NULL DEFAULT true,
 "billNotification" BOOLEAN NOT NULL DEFAULT true,
 "criticalStockNotification" BOOLEAN NOT NULL DEFAULT true,
 "notificationSound" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BranchSettings_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BranchSettings_payment_check" CHECK ("defaultPaymentMethod" IN ('CASH','CARD')),
 CONSTRAINT "BranchSettings_discount_check" CHECK ("maxDiscountPercent" BETWEEN 0 AND 100),
 CONSTRAINT "BranchSettings_customer_check" CHECK ("customerSelection" IN ('OPTIONAL','HIDDEN','REQUIRED')),
 CONSTRAINT "BranchSettings_critical_check" CHECK ("defaultCriticalLevel" >= 0),
 CONSTRAINT "BranchSettings_discount_roles_check" CHECK ("discountRoles" <@ ARRAY['OWNER','ADMIN','MANAGER','CASHIER']::TEXT[]),
 CONSTRAINT "BranchSettings_refund_roles_check" CHECK ("refundRoles" <@ ARRAY['OWNER','ADMIN','MANAGER']::TEXT[])
);
CREATE UNIQUE INDEX "BranchSettings_branchId_key" ON "BranchSettings"("branchId");
CREATE UNIQUE INDEX "BranchSettings_branchId_organizationId_key" ON "BranchSettings"("branchId","organizationId");
CREATE INDEX "BranchSettings_organizationId_idx" ON "BranchSettings"("organizationId");
ALTER TABLE "BranchSettings" ADD CONSTRAINT "BranchSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchSettings" ADD CONSTRAINT "BranchSettings_branchId_organizationId_fkey" FOREIGN KEY ("branchId","organizationId") REFERENCES "Branch"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
