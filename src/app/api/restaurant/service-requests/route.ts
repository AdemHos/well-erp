import { withPermission } from "@/lib/rbac";
import { listServiceRequests, qrError, qrJson } from "@/lib/qr-service";
export const GET = withPermission("service-requests.read", async (request: Request) => {
  try { return qrJson(await listServiceRequests(request)); } catch (e) { return qrError(e); }
});
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
