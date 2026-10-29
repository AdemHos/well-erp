import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { readBusiness, saveBusiness, settingsBody, settingsError, settingsJson } from "@/lib/settings-service";
export const dynamic = "force-dynamic";
export const GET = withPermission("settings.organization.manage", async () => {
  try { const actor = await getCurrentMembership({ required: true }); if (!actor) throw new AccessError("Oturum gerekli.", 401); return settingsJson({ business: await readBusiness(actor) }); } catch (e) { return settingsError(e); }
});
export const PATCH = withPermission("settings.organization.manage", async (request: Request) => {
  try { const actor = await getCurrentMembership({ required: true }); if (!actor) throw new AccessError("Oturum gerekli.", 401); return settingsJson({ business: await saveBusiness(actor, await settingsBody(request)) }); } catch (e) { return settingsError(e); }
});
