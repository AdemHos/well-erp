import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { withPermission } from "@/lib/rbac";
import { AccessError } from "@/lib/auth-context";
import { inviteStaff } from "@/lib/staff-service";

export const POST = withPermission("staff.manage", async (request: Request) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Geçersiz davet bilgisi.", 400);
  return NextResponse.json({ invitation: await inviteStaff((await getCurrentMembership())!, body), message: "Davet bağlantısı oluşturuldu. E-posta gönderilmedi." }, { status: 201 });
});
