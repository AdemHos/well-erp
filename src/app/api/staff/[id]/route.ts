import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { withPermission } from "@/lib/rbac";
import { AccessError } from "@/lib/auth-context";
import { changeStaff } from "@/lib/staff-service";

export const PATCH = withPermission("staff.manage", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Geçersiz personel bilgisi.", 400);
  const result = await changeStaff((await getCurrentMembership())!, (await context.params).id, body);
  return NextResponse.json({ membership: result, message: "Personel erişimi güncellendi." });
});
