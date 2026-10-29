import { Prisma } from "@/generated/prisma/client";

// No cache: a running process must observe an approved migration when it lands.
export async function paymentSchemaReady(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ExpensePayment' AND column_name='cancelledAt') AS ready`;
  return row?.ready === true;
}
export async function activePayments(tx: Prisma.TransactionClient): Promise<Prisma.PaymentWhereInput> {
  return await paymentSchemaReady(tx) ? { cancelledAt: null } : {};
}
export async function paymentSelect(tx: Prisma.TransactionClient) {
  const ready = await paymentSchemaReady(tx);
  return {
    id: true, organizationId: true, branchId: true, expenseId: true, amount: true,
    paidAt: true, description: true, reference: true, financeTransactionId: true,
    currentAccountEntryId: true, idempotencyKey: true, requestHash: true,
    createdAt: true, createdByUserId: true, createdByProfileId: true,
    type: ready, currentAccountId: ready, cancelledAt: ready, cancellationReason: ready,
    cancelledByUserId: ready, cancelledByProfileId: ready,
    reversalFinanceTransactionId: ready, reversalCurrentAccountEntryId: ready,
  } satisfies Prisma.PaymentSelect;
}
