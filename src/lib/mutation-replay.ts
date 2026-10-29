import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";

// Existing AuditLog primary keys provide durable replay protection without a schema rollout.
// PostgreSQL's transaction-scoped lock also serializes concurrent first attempts.
export async function mutationReplay(tx: Prisma.TransactionClient, organizationId: string, operation: string, key: unknown, payload: unknown) {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new CashError("Geçerli bir istek anahtarı gereklidir.");
  const digest = createHash("sha256").update(JSON.stringify([organizationId, operation, key])).digest("hex");
  const id = `request_${digest}`;
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  // Project an integer: Prisma cannot deserialize PostgreSQL's void lock result.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const saved = await tx.auditLog.findUnique({ where: { id } });
  if (saved && (saved.organizationId !== organizationId || (saved.metadata as { requestHash?: string } | null)?.requestHash !== requestHash)) throw new CashError("İstek anahtarı farklı bir işlem için kullanılmış.", 409);
  return { id, requestHash, entityId: saved?.entityId ?? null };
}
export async function rememberMutation(tx: Prisma.TransactionClient, actor: { userId: string; organizationId: string; profileId?: string }, attempt: { id: string; requestHash: string }, operation: string, entityType: string, entityId: string, branchId: string) {
  await tx.auditLog.create({ data: { id: attempt.id, organizationId: actor.organizationId, actorUserId: actor.userId, actorProfileId: actor.profileId,
    branchId, action: operation, entityType, entityId, metadata: { requestHash: attempt.requestHash } } });
}
