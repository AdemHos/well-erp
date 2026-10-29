-- Apply only after a Neon backup and explicit deployment approval.
CREATE TABLE "BranchPrinterSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "paperWidth" TEXT NOT NULL DEFAULT '80',
    "receiptHeader" VARCHAR(160) NOT NULL DEFAULT '',
    "receiptFooter" VARCHAR(300) NOT NULL DEFAULT 'Teşekkür ederiz. Yine bekleriz!',
    "afterSalePrint" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BranchPrinterSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BranchPrinterSetting_paperWidth_check" CHECK ("paperWidth" IN ('58', '80')),
    CONSTRAINT "BranchPrinterSetting_afterSalePrint_check" CHECK ("afterSalePrint" IN ('MANUAL', 'OPEN_DIALOG'))
);
CREATE UNIQUE INDEX "BranchPrinterSetting_branchId_key" ON "BranchPrinterSetting"("branchId");
CREATE UNIQUE INDEX "BranchPrinterSetting_branchId_organizationId_key" ON "BranchPrinterSetting"("branchId", "organizationId");
CREATE INDEX "BranchPrinterSetting_organizationId_idx" ON "BranchPrinterSetting"("organizationId");
ALTER TABLE "BranchPrinterSetting" ADD CONSTRAINT "BranchPrinterSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchPrinterSetting" ADD CONSTRAINT "BranchPrinterSetting_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
