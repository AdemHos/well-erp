import { AccessError } from "@/lib/auth-context";
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const deny = () => { throw new AccessError("İstek kaynağına izin verilmiyor.", 403); };
  if (request.headers.get("sec-fetch-site") === "cross-site") deny();
  if (!origin) return;
  const target = new URL(request.url);
  const allowed = new Set([target.origin]);
  // Next.js can reconstruct request.url with its internal bind address. Host
  // retains the browser-facing authority, including the development port.
  const host = request.headers.get("host");
  if (host && !/[\s,/@?#\\]/.test(host)) {
    try { allowed.add(new URL(`${target.protocol}//${host}`).origin); } catch { /* Invalid Host is not an allowed origin. */ }
  }
  // TLS termination may also change the protocol. Only explicit server
  // configuration is trusted; arbitrary forwarded headers are not an allowlist.
  for (const configured of [process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    if (!configured) continue;
    try {
      const url = new URL(configured);
      if (["http:", "https:"].includes(url.protocol)) allowed.add(url.origin);
    } catch { /* Ignore malformed deployment configuration. */ }
  }
  if (!allowed.has(origin)) deny();
}

export async function boundedJson(request: Request, maxBytes = 65536, allowEmpty = false): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return null;
    throw new AccessError("İstek verisi gerekli.", 400);
  }
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { void reader.cancel(); throw new AccessError("İstek verisi çok büyük.", 413); }
      chunks.push(part.value);
    }
    if (size === 0 && allowEmpty) return null;
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError("Geçerli JSON gönderin.", 400);
  } finally { reader.releaseLock(); }
}
