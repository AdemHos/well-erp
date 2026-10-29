import { NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { AccessError } from "@/lib/auth-context";
import { readPrinterSettings, savePrinterSettings, isPrinterSchemaMissing } from "@/lib/printer-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(e: unknown) {
  if (e instanceof AccessError) return json({ error: e.message }, e.status);
  if (isPrinterSchemaMissing(e)) return json({ error: "Yazıcı ayarları için veritabanı güncellemesi henüz uygulanmadı." }, 503);
  return json({ error: "Yazıcı ayarları işlenemedi. Tekrar deneyin." }, 500);
}
type Context = { params: Promise<{ branchId: string }> };
export const GET = withPermission("context", async (_request: Request, context: Context) => {
  try {
    const actor = await getCurrentMembership({ required: true });
    if (!actor) throw new AccessError("Oturum açmanız gerekiyor.", 401);
    return json(await readPrinterSettings(actor, (await context.params).branchId));
  } catch (e) { return failure(e); }
});
export const PATCH = withPermission("integrations.manage", async (request: Request, context: Context) => {
  try {
    const actor = await getCurrentMembership({ required: true });
    if (!actor) throw new AccessError("Oturum açmanız gerekiyor.", 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError("JSON veri gönderin.", 415);
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) throw new AccessError("İstek verisi çok büyük.", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AccessError("Geçersiz JSON.", 400); }
    return json(await savePrinterSettings(actor, (await context.params).branchId, body));
  } catch (e) { return failure(e); }
});
