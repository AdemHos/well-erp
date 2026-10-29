-- Keep existing products sellable; ingredients can be opted out individually.
ALTER TABLE "Product" ADD COLUMN "isSellable" BOOLEAN NOT NULL DEFAULT true;
