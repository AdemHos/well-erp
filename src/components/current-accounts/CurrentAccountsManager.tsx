"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, button, CardForm, date, input, money, Notice, Pager, panel, secondary, side, Stat, types, type Card } from "./shared";

type Result = { accounts: Card[]; summary: { receivable: string; payable: string; activeCount: number }; pagination: { total: number; totalPages: number } };
export default function CurrentAccountsManager() {
  const [data, setData] = useState<Result | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true), [saving, setSaving] = useState(false);
  const [q, setQ] = useState(""), [type, setType] = useState(""), [active, setActive] = useState("all"), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [form, setForm] = useState<Card | "new" | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const params = new URLSearchParams({ q, type, active, page: String(page) });
        const result = await api<Result>("/api/current-accounts?" + params, { signal: controller.signal });
        if (!controller.signal.aborted) setData(result);
      } catch (error) { if (!controller.signal.aborted) { setData(null); setError(error instanceof Error ? error.message : "Cariler yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, type, active, page, revision]);
  async function toggle(card: Card) {
    if (lock.current) return; lock.current = true; setSaving(true); setError("");
    try {
      await api("/api/current-accounts/" + card.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !card.isActive }) });
      setRevision(value => value + 1); setMessage(card.isActive ? "Cari pasifleştirildi; geçmişi korundu." : "Cari aktifleştirildi.");
    } catch (error) { setError(error instanceof Error ? error.message : "Cari güncellenemedi."); }
    finally { lock.current = false; setSaving(false); }
  }
  return <div className="space-y-5">
    <Notice error={error} message={message}/>
    <div className="grid gap-4 sm:grid-cols-3"><Stat tone="green" title="Toplam müşteri alacağı" value={money(data?.summary.receivable)}/><Stat tone="amber" title="Toplam tedarikçi borcu" value={money(data?.summary.payable)}/><Stat tone="violet" title="Aktif cari sayısı" value={String(data?.summary.activeCount ?? 0)}/></div>
    <p className="text-xs text-muted-foreground">Parasal toplamlar yalnızca yetkili şubeleri kapsar; üst kartlar liste filtrelerinden bağımsızdır. Cari kartları işletme genelinde ortaktır. Pasif carilerin açık bakiyeleri toplamda korunur.</p>
    {form && <CardForm key={form === "new" ? "new" : form.id} card={form === "new" ? undefined : form} onCancel={() => setForm(null)} onSaved={() => { setForm(null); setRevision(value => value + 1); setMessage("Cari kaydedildi. Açılış için Detay / Ekstre ekranını kullanın."); }}/>}
    <section className={panel + " space-y-5"}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Cari hesaplar <span className="text-muted-foreground">({data?.pagination.total ?? 0})</span></h2><button className={button} onClick={() => setForm("new")}>+ Yeni cari</button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">Cari ara<input className={input} placeholder="Kod, unvan, telefon veya e-posta" maxLength={200} value={q} onChange={event => { setQ(event.target.value); setPage(1); }}/></label>
        <label className="text-sm">Cari türü<select className={input} value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="">Tüm türler</option>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm">Durum<select className={input} value={active} onChange={event => { setActive(event.target.value); setPage(1); }}><option value="all">Aktif ve pasif</option><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
      </div>
      {busy && <p role="status" className="text-sm text-muted-foreground">Cariler yükleniyor…</p>}
      <div className="grid gap-4 lg:grid-cols-2" aria-busy={busy}>
        {data?.accounts.map(card => <article key={card.id} className="finance-item min-w-0 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-primary">{card.code} · {types[card.type]}</p><Link className="mt-1 block break-words text-lg font-bold hover:underline" href={"/dashboard/accounts/" + card.id}>{card.name}</Link></div><span className={"shrink-0 rounded-full px-2 py-1 text-xs " + (card.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground")}>{card.isActive ? "Aktif" : "Pasif"}</span></div>
          <p className="mt-3 text-xl font-bold">{money(card.balance)}</p><p className="text-xs text-muted-foreground">{side(card.balance)} · Yetkili şubeler</p>
          <p className="mt-3 break-words text-sm text-muted-foreground">{card.phone || "Telefon yok"}{card.email && " · " + card.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">Oluşturulma: {date(card.createdAt)}</p>
          <div className="mt-4 flex flex-wrap gap-2"><Link className={button} href={"/dashboard/accounts/" + card.id}>Detay / Ekstre</Link><button className={secondary} onClick={() => setForm(card)}>Düzenle</button><button className={secondary} disabled={saving} onClick={() => void toggle(card)}>{card.isActive ? "Pasifleştir" : "Aktifleştir"}</button></div>
        </article>)}
      </div>
      {!busy && data?.accounts.length === 0 && <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">Filtrelere uygun cari bulunamadı.</p>}
      <Pager page={page} pages={data?.pagination.totalPages ?? 0} busy={busy} onChange={setPage}/>
    </section>
  </div>;
}
