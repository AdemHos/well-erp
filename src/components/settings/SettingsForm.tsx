"use client";
import { settingSections } from "@/lib/settings";
import { useEffect, useState, type ReactNode } from "react";

export const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500";
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const before = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const contextChange = (event: Event) => { if (!window.confirm("Kaydedilmemiş ayarlar var. İşletme veya şube değiştirilsin mi?")) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a");
      if (!link || !link.href || link.target === "_blank" || link.hasAttribute("download") || link.hash && link.pathname === location.pathname) return;
      if (!window.confirm("Kaydedilmemiş değişiklikler var. Sayfadan ayrılmak istiyor musunuz?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", before); document.addEventListener("click", navigate, true);
    window.addEventListener("wellpos:settings-navigation", contextChange);
    return () => { window.removeEventListener("beforeunload", before); document.removeEventListener("click", navigate, true); window.removeEventListener("wellpos:settings-navigation", contextChange); };
  }, [dirty]);
}
export function SettingsForm<T extends object>({ title, scope, endpoint, property, section, canEdit, children, onDirty }: { title: string; scope: string; endpoint: string; property: string; section?: string; canEdit: boolean; children: (value: T, change: (key: keyof T, value: T[keyof T]) => void) => ReactNode; onDirty: (dirty: boolean) => void }) {
  const [value, setValue] = useState<T | null>(null), [saved, setSaved] = useState<T | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [ready, setReady] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState(""), [revision, refresh] = useState(0);
  const dirty = value !== null && JSON.stringify(value) !== JSON.stringify(saved);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Ayarlar alınamadı."); return data; }).then(data => {
      if (controller.signal.aborted) return;
      setValue(data[property]); setSaved(data[property]); setReady(data.storageReady !== false); setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(e.message ?? "Ayarlar alınamadı."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, property, revision]);
  async function save() {
    if (!value || !canEdit || busy || !ready) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const body = section ? { section, settings: Object.fromEntries(sectionKeys(section).map(k => [k, (value as Record<string, unknown>)[k]])) } : value;
      const r = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Ayarlar kaydedilemedi.");
      setValue(data[property]); setSaved(data[property]); setMessage("Ayarlar kaydedildi.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ayarlar kaydedilemedi."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={title}><header className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">{scope}</span></header>
    {loading ? <p role="status">Ayarlar yükleniyor…</p> : value && <fieldset disabled={!canEdit || busy || !ready} className="space-y-4">{children(value, (key, next) => { setValue(v => v && ({ ...v, [key]: next })); setMessage(""); })}</fieldset>}
    {!loading && !ready && <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Veritabanı güncellemesi bekleniyor. Güvenli varsayılanlar geçerli; kaydetme kapalı.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    {dirty && <p role="status" className="mt-3 text-sm text-amber-700">Kaydedilmemiş değişiklikler var.</p>}
    {!canEdit && <p className="mt-3 text-xs text-slate-500">Bu bölüm için düzenleme yetkiniz yok.</p>}
    <div className="mt-4 flex gap-3"><button type="button" disabled={!canEdit || !dirty || loading || busy || !ready} onClick={() => void save()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Kaydediliyor…" : "Kaydet"}</button><button type="button" disabled={busy} onClick={() => { if (dirty && !window.confirm("Kaydedilmemiş değişiklikler silinecek. Devam edilsin mi?")) return; setLoading(true); setMessage(""); refresh(v => v + 1); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">Yenile</button></div>
  </section>;
}
function sectionKeys(section: string): readonly string[] { return settingSections[section as keyof typeof settingSections] ?? []; }
