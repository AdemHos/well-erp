import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { withPermission } from "@/lib/rbac";
import { revokeStaffInvitation } from "@/lib/staff-service";
export const PATCH = withPermission("staff.manage", async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  await revokeStaffInvitation((await getCurrentMembership())!, (await context.params).id);
  return NextResponse.json({ message: "Davet iptal edildi." });
});
