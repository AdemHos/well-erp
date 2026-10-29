-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_OUT';

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeName" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionItem" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "ingredientUnit" "ProductUnit" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ProductionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Production_organizationId_createdAt_idx" ON "Production"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Production_branchId_createdAt_idx" ON "Production"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Production_productId_idx" ON "Production"("productId");

-- CreateIndex
CREATE INDEX "Production_recipeId_idx" ON "Production"("recipeId");

-- CreateIndex
CREATE INDEX "ProductionItem_productionId_idx" ON "ProductionItem"("productionId");

-- CreateIndex
CREATE INDEX "ProductionItem_ingredientId_idx" ON "ProductionItem"("ingredientId");

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;
