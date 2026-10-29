"use client";
import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
export type SelectedCustomer = { id: string; name: string; code: string };
export default function CustomerPicker({ value, onChange, disabled }: { value: SelectedCustomer | null; onChange: (value: SelectedCustomer | null) => void; disabled: boolean }) {
  const [query, setQuery] = useState(""), [customers, setCustomers] = useState<SelectedCustomer[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.trim().length < 2 || value) { setCustomers([]); setBusy(false); setError(""); return; }
      setBusy(true); setError("");
      try { const response = await fetch("/api/customers/lookup?q=" + encodeURIComponent(query.trim()), { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Müşteri araması yapılamadı."); if (!controller.signal.aborted) setCustomers(data.customers); }
      catch (e) { if (!controller.signal.aborted) { setCustomers([]); setError(e instanceof Error ? e.message : "Müşteri araması yapılamadı."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, value]);
  return <section className="mx-5 mb-4 rounded-xl bg-blue-50/70 p-3" aria-label="İsteğe bağlı müşteri seçimi"><p className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700"><UserRound size={15} aria-hidden="true"/>Müşteri <span className="font-normal text-slate-500">· İsteğe bağlı</span></p>{value ? <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800">{value.name}</p><p className="text-xs text-blue-600">{value.code}</p></div><button type="button" aria-label="Müşteri seçimini kaldır" disabled={disabled} className="rounded-lg p-2 text-slate-500 hover:bg-blue-100 disabled:opacity-50" onClick={() => { onChange(null); setQuery(""); }}><X size={17}/></button></div> : <><label className="relative block"><span className="sr-only">Müşteri adı, kodu veya telefonu</span><Search className="absolute left-3 top-3 text-slate-400" size={16} aria-hidden="true"/><input className="w-full rounded-xl border border-blue-100 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-50" maxLength={100} disabled={disabled} value={query} onChange={e => setQuery(e.target.value)} placeholder="Ad, kod veya telefonla arayın"/></label><div aria-live="polite">{busy && <p className="mt-2 text-xs text-slate-500">Aranıyor…</p>}{error && <p role="alert" className="mt-2 text-xs text-amber-800">{error} Müşteri seçmeden satış yapabilirsiniz.</p>}{!busy && !error && query.trim().length >= 2 && !customers.length && <p className="mt-2 text-xs text-slate-500">Aktif müşteri bulunamadı. Seçim yapmadan satışa devam edebilirsiniz.</p>}</div>{!!customers.length && <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-white p-1">{customers.map(c => <li key={c.id}><button type="button" disabled={disabled} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-50" onClick={() => { onChange(c); setQuery(""); setCustomers([]); }}><span className="block font-medium text-slate-800">{c.name}</span><span className="text-xs text-blue-600">{c.code}</span></button></li>)}</ul>}</>}</section>;
}
