import type { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";
export async function stockReplay(tx: Prisma.TransactionClient, organizationId: string, branchId: string, productId: string, movementId: string) {
  const include = { product: { select: { id: true, name: true, sku: true, barcode: true } }, branch: { select: { id: true, name: true } } };
  const movement = await tx.stockMovement.findFirst({ where: { id: movementId, organizationId, branchId, productId }, include });
  const stock = await tx.branchStock.findFirst({ where: { organizationId, branchId, productId }, include });
  if (!movement || !stock) throw new CashError("Önceki stok işlemi doğrulanamadı.", 409);
  return { stock, movement };
}
