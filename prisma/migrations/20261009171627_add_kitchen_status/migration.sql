-- CreateEnum
CREATE TYPE "KitchenStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED');

-- AlterTable
ALTER TABLE "TabItem" ADD COLUMN     "kitchenReadyAt" TIMESTAMP(3),
ADD COLUMN     "kitchenServedAt" TIMESTAMP(3),
ADD COLUMN     "kitchenStartedAt" TIMESTAMP(3),
ADD COLUMN     "kitchenStatus" "KitchenStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "TabItem_kitchenStatus_idx" ON "TabItem"("kitchenStatus");
