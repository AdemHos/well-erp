import { NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { saveLocalProfile } from "@/lib/staff-profiles";
export const PATCH = withPermission("staff.manage", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Personel bilgileri geçersiz.", 400);
  return NextResponse.json(await saveLocalProfile((await getCurrentMembership())!, (await context.params).id, body));
});
