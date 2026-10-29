import { withPermission } from "@/lib/rbac";
import { getQrSettings, saveQrSettings, qrBody, qrError, qrJson } from "@/lib/qr-service";
type Context = { params: Promise<{ branchId: string }> };
export const GET = withPermission("qr-menu.manage", async (_request: Request, context: Context) => {
  try { return qrJson(await getQrSettings((await context.params).branchId)); } catch (e) { return qrError(e); }
});
export const PATCH = withPermission("qr-menu.manage", async (request: Request, context: Context) => {
  try { return qrJson(await saveQrSettings((await context.params).branchId, await qrBody(request))); } catch (e) { return qrError(e); }
});
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
