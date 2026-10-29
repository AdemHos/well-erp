import type { Prisma } from "@/generated/prisma/client";
import { settingsReady } from "@/lib/settings-policy";
export async function customerSchemaReady(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."Customer"') IS NOT NULL AS ready`;
  return row?.ready === true;
}
// Always omit new order columns from legacy writers. Reads opt in after schema detection.
export const legacyCustomerOmit = { customerId: true, customerSnapshot: true, businessSnapshot: true } as const;
export async function orderCustomerOmit(tx: Prisma.TransactionClient) {
  return { ...(await customerSchemaReady(tx) ? { customerId: false, customerSnapshot: false } : legacyCustomerOmit), businessSnapshot: !await settingsReady(tx) };
}
