BEGIN;

ALTER TABLE "StockMovement" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Preserve the historical timestamp for existing stock movements.
UPDATE "StockMovement" SET "updatedAt" = "createdAt";

ALTER TABLE "StockMovement" ALTER COLUMN "updatedAt" SET NOT NULL;

COMMIT;
