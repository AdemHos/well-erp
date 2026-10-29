import { withPermission } from "@/lib/rbac";
import { changeServiceRequest, qrBody, qrError, qrJson } from "@/lib/qr-service";
export const PATCH = withPermission("service-requests.manage", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  try { return qrJson(await changeServiceRequest((await context.params).id, await qrBody(request))); } catch (e) { return qrError(e); }
});
export const runtime = "nodejs";
