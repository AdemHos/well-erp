BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "website" TEXT,
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

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierProductCode" TEXT,
    "lastPurchasePrice" DECIMAL(12,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_currentAccountId_key" ON "Supplier"("currentAccountId");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_isActive_idx" ON "Supplier"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_name_id_idx" ON "Supplier"("organizationId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_currentAccountId_organizationId_key" ON "Supplier"("currentAccountId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_code_key" ON "Supplier"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_idempotencyKey_key" ON "Supplier"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierProduct_organizationId_productId_idx" ON "SupplierProduct"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_organizationId_supplierId_productId_key" ON "SupplierProduct"("organizationId", "supplierId", "productId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_currentAccountId_organizationId_fkey" FOREIGN KEY ("currentAccountId", "organizationId") REFERENCES "CurrentAccount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdByProfileId_organizationId_fkey" FOREIGN KEY ("createdByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_normalized_code" CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$');
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_name_nonempty" CHECK (length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_version_positive" CHECK (version > 0);
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tax_number" CHECK ("taxNumber" IS NULL OR "taxNumber" ~ '^[0-9]{10,11}$');
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_price_nonnegative" CHECK ("lastPurchasePrice" IS NULL OR "lastPurchasePrice" >= 0);
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_version_positive" CHECK (version > 0);
COMMIT;
