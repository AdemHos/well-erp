import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { readBranchSettings, saveBranchSection, settingsBody, settingsError, settingsJson } from "@/lib/settings-service";
import { record, settingSections, type SettingSection } from "@/lib/settings";
type Context = { params: Promise<{ branchId: string }> };
export const dynamic = "force-dynamic";
export const GET = withPermission("settings.read", async (_request: Request, context: Context) => {
  try { const actor = await getCurrentMembership({ required: true }); if (!actor) throw new AccessError("Oturum gerekli.", 401); return settingsJson(await readBranchSettings(actor, (await context.params).branchId)); } catch (e) { return settingsError(e); }
});
export const PATCH = withPermission("settings.branch.manage", async (request: Request, context: Context) => {
  try {
    const actor = await getCurrentMembership({ required: true }); if (!actor) throw new AccessError("Oturum gerekli.", 401);
    let body: Record<string, unknown>;
    try { body = record(await settingsBody(request)); } catch (e) { if (e instanceof AccessError) throw e; throw new AccessError("Ayar verisi geçersiz.", 400); }
    if (Object.keys(body).some(k => !["section", "settings"].includes(k)) || typeof body.section !== "string" || !Object.hasOwn(settingSections, body.section)) throw new AccessError("Ayar bölümü geçersiz.", 400);
    return settingsJson(await saveBranchSection(actor, (await context.params).branchId, body.section as SettingSection, body.settings));
  } catch (e) { return settingsError(e); }
});
