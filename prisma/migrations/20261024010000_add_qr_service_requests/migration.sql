-- Additive migration. Existing tables receive nullable fields / a zero counter only.
CREATE TYPE "ServiceRequestType" AS ENUM ('WAITER_CALL', 'BILL_REQUEST');
CREATE TYPE "ServiceRequestStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED');
ALTER TABLE "RestaurantTable"
  ADD COLUMN "qrTokenHash" TEXT,
  ADD COLUMN "qrTokenRotatedAt" TIMESTAMP(3),
  ADD COLUMN "requestWindowStartedAt" TIMESTAMP(3),
  ADD COLUMN "requestWindowCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "RestaurantTable_requestWindowCount_check" CHECK ("requestWindowCount" >= 0);
CREATE UNIQUE INDEX "RestaurantTable_qrTokenHash_key" ON "RestaurantTable"("qrTokenHash");
CREATE UNIQUE INDEX "RestaurantTable_id_branchId_organizationId_key" ON "RestaurantTable"("id", "branchId", "organizationId");
CREATE UNIQUE INDEX "Tab_id_tableId_branchId_organizationId_key" ON "Tab"("id", "tableId", "branchId", "organizationId");
CREATE TABLE "BranchQrMenu" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "serviceRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "waiterCallEnabled" BOOLEAN NOT NULL DEFAULT false,
  "billRequestEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchQrMenu_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BranchQrMenu_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BranchQrMenu_branchId_key" ON "BranchQrMenu"("branchId");
CREATE UNIQUE INDEX "BranchQrMenu_branchId_organizationId_key" ON "BranchQrMenu"("branchId", "organizationId");
CREATE UNIQUE INDEX "BranchQrMenu_publicToken_key" ON "BranchQrMenu"("publicToken");
CREATE INDEX "BranchQrMenu_organizationId_idx" ON "BranchQrMenu"("organizationId");
CREATE TABLE "ServiceRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "tabId" TEXT,
  "type" "ServiceRequestType" NOT NULL,
  "status" "ServiceRequestStatus" NOT NULL DEFAULT 'PENDING',
  "acknowledgedByUserId" TEXT,
  "acknowledgedByProfileId" TEXT,
  "completedByUserId" TEXT,
  "completedByProfileId" TEXT,
  "cancelledByUserId" TEXT,
  "cancelledByProfileId" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_tableId_branchId_organizationId_fkey" FOREIGN KEY ("tableId", "branchId", "organizationId") REFERENCES "RestaurantTable"("id", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_tabId_tableId_branchId_organizationId_fkey" FOREIGN KEY ("tabId", "tableId", "branchId", "organizationId") REFERENCES "Tab"("id", "tableId", "branchId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_acknowledgedByProfileId_organizationId_fkey" FOREIGN KEY ("acknowledgedByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_completedByProfileId_organizationId_fkey" FOREIGN KEY ("completedByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_cancelledByProfileId_organizationId_fkey" FOREIGN KEY ("cancelledByProfileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceRequest_state_check" CHECK (
    ("type" <> 'BILL_REQUEST' OR "tabId" IS NOT NULL) AND
    (("acknowledgedAt" IS NULL AND "acknowledgedByUserId" IS NULL AND "acknowledgedByProfileId" IS NULL) OR ("acknowledgedAt" IS NOT NULL AND "acknowledgedByUserId" IS NOT NULL)) AND
    (("status" = 'PENDING' AND "acknowledgedAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR
     ("status" = 'ACKNOWLEDGED' AND "acknowledgedAt" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR
     ("status" = 'COMPLETED' AND "acknowledgedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "cancelledAt" IS NULL) OR
     ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND "completedAt" IS NULL)) AND
    ("completedAt" IS NOT NULL OR ("completedByUserId" IS NULL AND "completedByProfileId" IS NULL)) AND
    ("cancelledAt" IS NOT NULL OR ("cancelledByUserId" IS NULL AND "cancelledByProfileId" IS NULL))
  )
);
CREATE UNIQUE INDEX "ServiceRequest_open_table_type_key" ON "ServiceRequest"("tableId", "type") WHERE "status" IN ('PENDING', 'ACKNOWLEDGED');
CREATE INDEX "ServiceRequest_organizationId_branchId_status_createdAt_idx" ON "ServiceRequest"("organizationId", "branchId", "status", "createdAt");
CREATE INDEX "ServiceRequest_organizationId_branchId_createdAt_idx" ON "ServiceRequest"("organizationId", "branchId", "createdAt");
CREATE INDEX "ServiceRequest_tableId_type_createdAt_idx" ON "ServiceRequest"("tableId", "type", "createdAt");
