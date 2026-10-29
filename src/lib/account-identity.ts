import type { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";

// Every cari creation path calls this inside a Serializable transaction. Predicate
// reads plus PostgreSQL SSI prevent concurrent duplicate identities (P2034 retries).
export async function assertAccountIdentityAvailable(tx: Prisma.TransactionClient, organizationId: string, taxNumber: string | null | undefined, excludeId?: string) {
  if (!taxNumber) return;
  if (await tx.currentAccount.findFirst({ where: { organizationId, taxNumber, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } })) {
    throw new CashError("Bu vergi numarası / TCKN ile mevcut cari var. Mevcut kartı kullanın; gerekiyorsa türünü BOTH yapın.", 409);
  }
}

export async function supplierSchemaReady(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."Supplier"') IS NOT NULL AS ready`;
  return row?.ready === true;
}
