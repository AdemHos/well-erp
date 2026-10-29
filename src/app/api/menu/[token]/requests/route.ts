import { createPublicRequest, publicRequestGuard, qrBody, qrError, qrJson } from "@/lib/qr-service";
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    publicRequestGuard(request);
    const result = await createPublicRequest((await context.params).token, await qrBody(request));
    return qrJson(result, result.limited ? 429 : result.noTab ? 409 : result.existing ? 200 : 201);
  } catch (e) { return qrError(e); }
}
export const runtime = "nodejs";
