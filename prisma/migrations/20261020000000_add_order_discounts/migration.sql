-- Existing orders retain their original totals and receive zero discount.
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

ALTER TABLE "Order"
ADD COLUMN "discountType" "DiscountType",
ADD COLUMN "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
