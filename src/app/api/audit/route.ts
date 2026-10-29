import { pagination } from "@/lib/current-accounts";
import { CashError } from "@/lib/cash-management";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchScope } from "@/lib/permissions";
export const GET = withPermission("audit.read", async (request: Request) => {
  try {
  const params = new URL(request.url).searchParams;
  if (!params.has("limit")) params.set("limit", "100");
  const { page, limit, skip } = pagination(params);
  const member = (await getCurrentMembership())!;
  const entries = await prisma.auditLog.findMany({ where: { organizationId: member.organizationId, ...branchScope(member) },
    select: { id: true, action: true, entityType: true, entityId: true, branchId: true, actorUserId: true, actorProfileId: true, actorProfile: { select: { name: true } }, createdAt: true, metadata: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip });
  return NextResponse.json({ entries, page, limit, hasMore: entries.length === limit });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
