import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError, membershipContext } from "@/lib/auth-context";
import { branchIdScope, branchScope, hasPermission, type Permission } from "@/lib/permissions";
import { assertSameOrigin, boundedJson } from "@/lib/http-security";

type Resource = "branch" | "tab" | "table" | "tabItem";
export function withPermission<A extends unknown[], R>(permission: Permission, handler: (...args: A) => Promise<R>, resource?: Resource) {
  return async (...args: A): Promise<R | NextResponse> => {
    try {
      const member = await getCurrentMembership({ required: true });
      if (!member) throw new AccessError("Oturum açmanız gerekiyor.", 401);
      if (!hasPermission(member.role, permission)) throw new AccessError("Bu işlem için yetkiniz yok.", 403);
      const request = args[0] instanceof Request ? args[0] : undefined;
      if (request && request.method !== "GET") assertSameOrigin(request);
      const context = args[1] as { params?: Promise<Record<string, string>> } | undefined;
      const params = context?.params ? await context.params : {};
      const ids = new Set<string>();
      let bodyRecordId: string | undefined;
      if (params.branchId) ids.add(params.branchId);
      if (request) {
        for (const [key, value] of new URL(request.url).searchParams) if (["branchId", "fromBranchId", "toBranchId"].includes(key) && value) ids.add(value);
        if (request.method !== "GET") {
          const body = request.body ? await boundedJson(request.clone(), 65536, true) as Record<string, unknown> | null : null;
          for (const key of ["branchId", "fromBranchId", "toBranchId"]) if (typeof body?.[key] === "string" && body[key]) ids.add(body[key]);
          if (resource === "table" && typeof body?.tableId === "string") bodyRecordId = body.tableId;
        }
      }
      for (const id of ids) {
        const branch = await prisma.branch.findFirst({ where: { AND: [{ id, organizationId: member.organizationId }, branchIdScope(member)] }, select: { id: true } });
        if (!branch) throw new AccessError("Şube bulunamadı veya erişim yetkiniz yok.", 404);
      }
      const id = params.itemId ?? params.id ?? params.branchId ?? bodyRecordId;
      if (resource && id) {
        let found: { id: string } | null;
        const where = { id, organizationId: member.organizationId, ...branchScope(member) };
        if (resource === "tab") found = await prisma.tab.findFirst({ where, select: { id: true } });
        else if (resource === "table") found = await prisma.restaurantTable.findFirst({ where, select: { id: true } });
        else if (resource === "tabItem") found = await prisma.tabItem.findFirst({ where: { id, ...(params.id ? { tabId: params.id } : {}), tab: { organizationId: member.organizationId, ...branchScope(member) } }, select: { id: true } });
        else found = await prisma.branch.findFirst({ where: { AND: [{ id, organizationId: member.organizationId }, branchIdScope(member)] }, select: { id: true } });
        if (!found) throw new AccessError("Kayıt bulunamadı veya erişim yetkiniz yok.", 404);
      }
      return await membershipContext.run(member, () => handler(...args));
    } catch (error) {
      if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error("AUTHORIZATION_ERROR:", error instanceof Error ? error.name : "UnknownError");
      return NextResponse.json({ error: "İşlem gerçekleştirilemedi." }, { status: 500 });
    }
  };
}

export async function requirePagePermission(permission: Permission) {
  try {
    const member = await getCurrentMembership({ required: true });
    if (!member || !hasPermission(member.role, permission)) throw new AccessError("Yetkiniz yok.", 403);
    return member;
  } catch (error) {
    if (error instanceof AccessError) redirect(error.status === 401 ? "/login" : error.status === 428 ? "/profiles" : "/dashboard/access-denied");
    throw error;
  }
}
