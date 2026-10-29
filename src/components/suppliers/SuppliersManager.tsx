"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";
import SupplierForm from "./SupplierForm";
import { api, button, secondary, input, panel, Notice, Stat, Pager, money, type Supplier } from "./shared";
import { FinanceBadge } from "@/components/finance/finance-ui";

type Result = { organizationId: string; suppliers: (Supplier & { balance?: string })[]; summary: { total: number; active: number; payable?: string }; pagination: { total: number; totalPages: number }; permissions: { manage: boolean; finance: boolean } };
export default function SuppliersManager() {
  const [data, setData] = useState<Result | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(true), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({ q: "", active: "all" }), [editing, setEditing] = useState<Supplier | "new" | null>(null);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(async () => {
    setBusy(true); setError("");
    try { const result = await api<Result>("/api/suppliers?" + new URLSearchParams({ ...filters, page: String(page) }), { signal: controller.signal }); if (!controller.signal.aborted) setData(result); }
    catch (e) { if (!controller.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "Tedarikçiler yüklenemedi."); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, 180); return () => { clearTimeout(timer); controller.abort(); }; }, [filters, page, revision]);
  return <div className="space-y-5"><Notice error={error} message={message}/>
    <div className="grid gap-4 sm:grid-cols-3"><Stat title="Toplam tedarikçi" value={String(data?.summary.total ?? 0)}/><Stat tone="green" title="Aktif tedarikçi" value={String(data?.summary.active ?? 0)}/>{data?.permissions.finance && <Stat tone="amber" title="Açık tedarikçi borcu" value={money(data.summary.payable)}/>}</div>
    <p className="text-xs text-slate-500">Tedarikçiler işletmenin ortak havuzudur. Üst kartlar arama ve aktiflik filtresinden bağımsızdır; borç, pasifler dahil bağlı carilerin yalnız yetkili şubelerdeki hareketlerinden hesaplanır.</p>
    {editing && data && <SupplierForm organizationId={data.organizationId} key={editing === "new" ? "new" : editing.id} supplier={editing === "new" ? undefined : editing} canFinance={data.permissions.finance} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(n => n + 1); setMessage("Tedarikçi kaydedildi."); }}/>}<section className={panel + " space-y-5"}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Tedarikçiler ({data?.pagination.total ?? 0})</h2>{data?.permissions.manage && <button className={button} onClick={() => setEditing("new")}><Plus size={17}/>Yeni tedarikçi</button>}</div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Tedarikçi ara<input className={input} maxLength={200} placeholder="Unvan, kod, yetkili, telefon, e-posta veya vergi numarası" value={filters.q} onChange={e => { setFilters({ ...filters, q: e.target.value }); setPage(1); }}/></label><label className="text-sm">Durum<select className={input} value={filters.active} onChange={e => { setFilters({ ...filters, active: e.target.value }); setPage(1); }}><option value="all">Aktif ve pasif</option><option value="true">Aktif</option><option value="false">Pasif</option></select></label></div>
    {busy && <p role="status">Tedarikçiler yükleniyor…</p>}
    <div className="grid gap-4 lg:grid-cols-2" aria-busy={busy}>{data?.suppliers.map(s => <article key={s.id} className="finance-item min-w-0 rounded-2xl p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-blue-50 p-3 text-blue-600"><Truck size={21}/></span><div className="min-w-0 flex-1"><p className="text-xs text-blue-600">{s.code}</p><Link href={"/dashboard/suppliers/" + s.id} className="mt-1 block break-words text-lg font-bold hover:text-blue-600">{s.name}</Link></div><FinanceBadge tone={s.isActive ? "green" : "neutral"}>{s.isActive ? "Aktif" : "Pasif"}</FinanceBadge></div><div className="mt-4 space-y-1 break-words text-sm text-slate-500"><p>{s.contactName || "Yetkili eklenmemiş"}</p><p>{s.phone || "Telefon eklenmemiş"} · {s.email || "E-posta eklenmemiş"}</p><p>{[s.district, s.city].filter(Boolean).join(" / ")}</p>{data.permissions.finance && <p>{Number(s.balance) < 0 ? "Borç: " : Number(s.balance) > 0 ? "Alacak: " : "Bakiye kapalı: "}{money(String(Math.abs(Number(s.balance ?? 0))))}</p>}</div><div className="mt-5 flex flex-wrap gap-2"><Link className={button} href={"/dashboard/suppliers/" + s.id}>Tedarikçi detayları</Link>{data.permissions.manage && <button className={secondary} onClick={() => setEditing(s)}>Düzenle</button>}</div></article>)}</div>
    {!busy && data?.suppliers.length === 0 && <p className="rounded-2xl bg-blue-50 p-8 text-center">Tedarikçi bulunamadı. Filtreleri değiştirebilir veya yeni tedarikçi ekleyebilirsiniz.</p>}
    <Pager page={page} pages={data?.pagination.totalPages ?? 0} busy={busy} onChange={setPage}/></section></div>;
}
