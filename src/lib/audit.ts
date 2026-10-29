import type { Prisma } from "@/generated/prisma/client";
export async function writeAudit(tx: Prisma.TransactionClient, actor: { userId: string; organizationId: string; profileId?: string }, action: string, entityType: string, entityId?: string, branchId?: string, metadata?: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { actorUserId: actor.userId, actorProfileId: actor.profileId, organizationId: actor.organizationId, branchId, action, entityType, entityId, metadata } });
}
