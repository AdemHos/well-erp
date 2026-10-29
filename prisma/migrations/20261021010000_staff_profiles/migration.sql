-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorProfileId" TEXT;

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allBranches" BOOLEAN NOT NULL DEFAULT false,
    "pinHash" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfileBranch" (
    "profileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "StaffProfileBranch_pkey" PRIMARY KEY ("profileId","branchId")
);

-- CreateTable
CREATE TABLE "StaffProfileSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceSessionHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffProfileSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_membershipId_key" ON "StaffProfile"("membershipId");

-- CreateIndex
CREATE INDEX "StaffProfile_organizationId_isActive_idx" ON "StaffProfile"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_id_organizationId_key" ON "StaffProfile"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_membershipId_organizationId_key" ON "StaffProfile"("membershipId", "organizationId");

-- CreateIndex
CREATE INDEX "StaffProfileBranch_branchId_organizationId_idx" ON "StaffProfileBranch"("branchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfileSession_tokenHash_key" ON "StaffProfileSession"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffProfileSession_profileId_idx" ON "StaffProfileSession"("profileId");

-- CreateIndex
CREATE INDEX "StaffProfileSession_userId_expiresAt_idx" ON "StaffProfileSession"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorProfileId_fkey" FOREIGN KEY ("actorProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "Membership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfileBranch" ADD CONSTRAINT "StaffProfileBranch_profileId_organizationId_fkey" FOREIGN KEY ("profileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfileBranch" ADD CONSTRAINT "StaffProfileBranch_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfileSession" ADD CONSTRAINT "StaffProfileSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfileSession" ADD CONSTRAINT "StaffProfileSession_profileId_organizationId_fkey" FOREIGN KEY ("profileId", "organizationId") REFERENCES "StaffProfile"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
