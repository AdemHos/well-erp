"use client";
import { financeInput, financeButton, financeSecondary, financePanel } from "@/components/finance/finance-ui";
export { FinanceStat as Stat } from "@/components/finance/finance-ui";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

export type Card = {
  id: string; code: string; name: string; type: "CUSTOMER" | "SUPPLIER" | "BOTH";
  phone: string | null; email: string | null; address: string | null;
  taxOffice: string | null; taxNumber: string | null; description: string | null;
  isActive: boolean; createdAt: string; balance?: string; totalDebit?: string; totalCredit?: string;
};
export const types = { CUSTOMER: "Müşteri", SUPPLIER: "Tedarikçi", BOTH: "Müşteri ve tedarikçi" };
export const kinds: Record<string, string> = { EXPENSE: "Gider tahakkuku", OPENING: "Açılış", ADJUSTMENT: "Manuel düzeltme", REVERSAL: "Ters kayıt", CREDIT_SALE: "Vadeli satış", CREDIT_PURCHASE: "Vadeli alış", INVOICE: "Fatura", COLLECTION: "Tahsilat", PAYMENT: "Ödeme" };
export const input = financeInput;
export const button = financeButton;
export const secondary = financeSecondary;
export const panel = financePanel;
export const money = (value: string = "0") => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(value));
export const date = (value: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
export const side = (balance: string = "0") => Number(balance) > 0 ? "İşletme alacaklı" : Number(balance) < 0 ? "İşletme borçlu" : "Bakiye kapalı";
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || "İşlem tamamlanamadı.", response.status);
  return result as T;
}
export function Notice({ error, message }: { error?: string; message?: string }) {
  return <>{error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div>}{message && <div role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700">{message}</div>}</>;
}
export function Pager({ page, pages, busy, onChange }: { page: number; pages: number; busy: boolean; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-end gap-3"><button className={secondary} disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>Önceki</button><span className="text-sm">Sayfa {page} / {Math.max(1, pages)}</span><button className={secondary} disabled={busy || page >= pages} onClick={() => onChange(page + 1)}>Sonraki</button></div>;
}

export function CardForm({ card, onSaved, onCancel }: { card?: Card; onSaved: (card: Card) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ code: card?.code ?? "", name: card?.name ?? "", type: card?.type ?? "CUSTOMER", phone: card?.phone ?? "", email: card?.email ?? "", address: card?.address ?? "", taxOffice: card?.taxOffice ?? "", taxNumber: card?.taxNumber ?? "", description: card?.description ?? "", isActive: card?.isActive ?? true });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ account: Card }>(card ? "/api/current-accounts/" + card.id : "/api/current-accounts", { method: card ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onSaved(result.account);
    } catch (error) { setError(error instanceof Error ? error.message : "Cari kaydedilemedi."); }
    finally { lock.current = false; setBusy(false); }
  }
  const fields = [{ key: "code", label: "Cari kodu", max: 40, required: true }, { key: "name", label: "Cari adı / ticari unvan", max: 200, required: true }, { key: "phone", label: "Telefon", max: 40 }, { key: "email", label: "E-posta", max: 254 }, { key: "taxOffice", label: "Vergi dairesi", max: 100 }, { key: "taxNumber", label: "Vergi numarası / TCKN (isteğe bağlı)", max: 11 }] as const;
  return <form onSubmit={submit} className={panel + " space-y-4"}>
    <h2 className="text-lg font-bold">{card ? "Cari düzenle" : "Yeni cari hesap"}</h2><Notice error={error}/>
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      {fields.map(field => <label key={field.key} className="space-y-1 text-sm"><span>{field.label}</span><input className={input} required={"required" in field && field.required} maxLength={field.max} type={field.key === "email" ? "email" : field.key === "phone" ? "tel" : "text"} value={form[field.key]} onChange={event => setForm({ ...form, [field.key]: event.target.value })}/></label>)}
      <label className="space-y-1 text-sm">Cari türü<select className={input} value={form.type} onChange={event => setForm({ ...form, type: event.target.value as Card["type"] })}>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })}/>Aktif cari</label>
      <label className="space-y-1 text-sm sm:col-span-2">Adres<textarea className={input} maxLength={1000} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })}/></label>
      <label className="space-y-1 text-sm sm:col-span-2">Açıklama<textarea className={input} maxLength={1000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></label>
    </fieldset>
    <p className="text-xs text-muted-foreground">Açılış bakiyesini cari detayında şube seçerek girebilirsiniz. Finansal geçmiş silinmez.</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</button><button type="button" className={secondary} disabled={busy} onClick={onCancel}>Vazgeç</button></div>
  </form>;
}

type Pending = { url: string; body: Record<string, unknown>; idempotencyKey: string };
// Persist uncertain writes across reloads. The server still checks account and branch access.
export function useLedgerMutation(accountId: string, onDone: () => void) {
  const storageKey = "wellpos.current-account.pending." + accountId;
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), current = useRef<Pending | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        const saved = raw ? JSON.parse(raw) : null;
        const prefix = "/api/current-accounts/" + accountId + "/entries";
        if (saved && typeof saved.url === "string" && (saved.url === prefix || saved.url.startsWith(prefix + "/") && saved.url.endsWith("/reverse")) && saved.body && typeof saved.body === "object" && typeof saved.idempotencyKey === "string") { current.current = saved; setPending(saved); }
      } catch { /* Storage can be unavailable in restricted browsers. */ }
    });
    return () => { cancelled = true; };
  }, [accountId, storageKey]);
  const run = useCallback(async (url?: string, body?: Record<string, unknown>) => {
    if (lock.current) return;
    const request = current.current ?? (url && body ? { url, body, idempotencyKey: crypto.randomUUID() } : null);
    if (!request) return;
    current.current = request; setPending(request); lock.current = true; setBusy(true); setError("");
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)); } catch { /* In-memory retries remain safe. */ }
    const clear = () => { current.current = null; setPending(null); try { sessionStorage.removeItem(storageKey); } catch {} };
    try {
      await api(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request.body, idempotencyKey: request.idempotencyKey }) });
      clear(); onDone();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) clear();
      setError(error instanceof Error ? error.message : "İşlem sonucu doğrulanamadı.");
    } finally { lock.current = false; setBusy(false); }
  }, [onDone, storageKey]);
  return { run, pending: !!pending, busy, error };
}
