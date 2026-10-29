import { AccessError } from "@/lib/auth-context";
export function credentialsInput(body: unknown, registering = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AccessError("Geçerli hesap bilgisi gönderin.", 400);
  const data = body as Record<string, unknown>;
  if (typeof data.email !== "string" || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) throw new AccessError("Geçerli e-posta adresi girin.", 400);
  if (typeof data.password !== "string" || !data.password.length || Buffer.byteLength(data.password, "utf8") > 72 || (registering && data.password.length < 8)) throw new AccessError("Şifre en az 8 karakter ve en fazla 72 UTF-8 byte olmalıdır.", 400);
  if (registering && (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100)) throw new AccessError("Ad 1–100 karakter olmalıdır.", 400);
  return { email: data.email.trim().toLowerCase(), password: data.password, name: registering ? (data.name as string).trim() : "" };
}
