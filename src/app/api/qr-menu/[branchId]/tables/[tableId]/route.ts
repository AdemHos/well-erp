import { withPermission } from "@/lib/rbac";
import { rotateTableQr, qrError, qrJson } from "@/lib/qr-service";
type Context = { params: Promise<{ branchId: string; tableId: string }> };
export const POST = withPermission("qr-menu.manage", async (_request: Request, context: Context) => {
  try { const p = await context.params; return qrJson(await rotateTableQr(p.branchId, p.tableId)); } catch (e) { return qrError(e); }
});
export const DELETE = withPermission("qr-menu.manage", async (_request: Request, context: Context) => {
  try { const p = await context.params; return qrJson(await rotateTableQr(p.branchId, p.tableId, true)); } catch (e) { return qrError(e); }
});
export const runtime = "nodejs";
