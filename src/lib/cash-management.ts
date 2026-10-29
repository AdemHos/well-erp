import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";

export class CashError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function cashAmount(value: unknown, allowZero = false) {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) throw new CashError("Geçerli bir tutar girin.");
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(value); } catch { throw new CashError("Geçerli bir tutar girin."); }
  if (!amount.isFinite() || amount.lt(0) || (!allowZero && amount.eq(0)) || amount.decimalPlaces() > 2 || amount.gt("999999999999.99")) {
    throw new CashError("Tutar pozitif, en fazla iki ondalıklı ve izin verilen sınırlar içinde olmalıdır.");
  }
  return amount;
}

// Existing primary-key uniqueness also protects simultaneous retries without a migration.
export function transferIds(organizationId: string, key: string) {
  const digest = createHash("sha256").update(JSON.stringify([organizationId, key])).digest("hex");
  return { out: `transfer_${digest}_out`, in: `transfer_${digest}_in`, reference: `TRANSFER:${digest}` };
}

export async function assertCashAvailable(tx: Prisma.TransactionClient, account: { id: string; organizationId: string; openingBalance: Prisma.Decimal }, amount: Prisma.Decimal) {
  const groups = await tx.financeTransaction.groupBy({ by: ["direction"], where: { accountId: account.id, organizationId: account.organizationId }, _sum: { amount: true } });
  const balance = groups.reduce((total, row) => row.direction === "IN" ? total.plus(row._sum.amount ?? 0) : total.minus(row._sum.amount ?? 0), account.openingBalance);
  if (balance.lt(amount)) throw new CashError("Hesap bakiyesi bu işlem için yetersiz.", 409);
}

export async function serialCashTransaction<T>(db: { $transaction: unknown }, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const run = db.$transaction as (work: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: "Serializable"; timeout: number; maxWait: number }) => Promise<T>;
  for (let attempt = 0; ; attempt++) {
    try { return await run.call(db, work, { isolationLevel: "Serializable", timeout: 20000, maxWait: 5000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 3) throw error;
    }
  }
}
