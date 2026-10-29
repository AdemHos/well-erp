import { createHash } from "node:crypto";
import { AccessError } from "@/lib/auth-context";

type Bucket = { count: number; until: number };
const shared = globalThis as typeof globalThis & { wellposRateBuckets?: Map<string, Bucket> };
const buckets = shared.wellposRateBuckets ??= new Map<string, Bucket>();
export function consumeRateLimit(scope: string, identity: string, limit: number, windowMs: number, now = Date.now()) {
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const key = scope + ":" + createHash("sha256").update(identity).digest("hex");
  if (!buckets.has(key) && buckets.size >= 10000) throw new AccessError("Çok fazla istek. Lütfen daha sonra deneyin.", 429);
  const bucket = buckets.get(key) ?? { count: 0, until: now + windowMs };
  if (bucket.count >= limit) throw new AccessError("Çok fazla deneme. Lütfen daha sonra tekrar deneyin.", 429);
  bucket.count++; buckets.set(key, bucket);
}
// Only use a proxy header explicitly configured and sanitized by the deployment.
export function requestIdentity(request: Request) {
  const name = process.env.AUTH_TRUSTED_IP_HEADER;
  return name ? request.headers.get(name)?.slice(0, 100) || "shared" : "shared";
}
