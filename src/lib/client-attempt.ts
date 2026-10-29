export type ClientAttempt = { key: string; payload: string };
// Retain the key after an unknown response. Changed inputs require a new attempt.
export function clientAttempt(previous: ClientAttempt | null, payload: unknown, scope?: string): ClientAttempt {
  const serialized = JSON.stringify(payload);
  let saved = previous;
  if (!saved && scope && typeof sessionStorage !== "undefined") {
    try { const value = JSON.parse(sessionStorage.getItem("wellpos-attempt:" + scope) ?? "null"); if (value && typeof value.key === "string" && typeof value.payload === "string") saved = value; } catch { /* Storage is optional. */ }
  }
  const attempt = saved?.payload === serialized ? saved : { key: crypto.randomUUID(), payload: serialized };
  if (scope && typeof sessionStorage !== "undefined") { try { sessionStorage.setItem("wellpos-attempt:" + scope, JSON.stringify(attempt)); } catch { /* Keep the in-memory key. */ } }
  return attempt;
}

export function completeAttempt(scope: string) {
  if (typeof sessionStorage !== "undefined") { try { sessionStorage.removeItem("wellpos-attempt:" + scope); } catch { /* Storage is optional. */ } }
}
