"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, button, CardForm, date, input, kinds, money, Notice, Pager, panel, secondary, side, Stat, types, useLedgerMutation, type Card } from "./shared";

type Entry = { invoiceId?: string | null; invoiceNumber?: string | null; id: string; kind: string; direction: "DEBIT" | "CREDIT"; amount: string; balance: string; description: string | null; reference: string | null; occurredAt: string; branchName: string; createdByName: string; reversalOfId: string | null; reversed: boolean; canReverse: boolean };
type Result = { account: Card; entries: Entry[]; summary: { debit: string; credit: string; opening: string; balance: string; totalDebit: string; totalCredit: string }; pagination: { total: number; totalPages: number } };
export default function CurrentAccountDetail({ accountId }: { accountId: string }) {
  const [data, setData] = useState<Result | null>(null), [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(true), [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState({ q: "", startDate: "", endDate: "", branchId: "", sort: "asc" }), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ branchId: "", kind: "OPENING", direction: "DEBIT", amount: "", description: "", reference: "", occurredAt: "" });
  const [showEntry, setShowEntry] = useState(false), [reverseId, setReverseId] = useState<string | null>(null), [reason, setReason] = useState("");
  const refresh = useCallback(() => { setRevision(value => value + 1); setShowEntry(false); setReverseId(null); setMessage("Cari hareketi kaydedildi."); setForm(value => ({ ...value, amount: "", description: "", reference: "" })); }, []);
  const mutation = useLedgerMutation(accountId, refresh);
  const params = new URLSearchParams({ ...filters, page: String(page) });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const query = new URLSearchParams({ ...filters, page: String(page) });
        const [result, branchResult] = await Promise.all([
          api<Result>("/api/current-accounts/" + accountId + "/entries?" + query, { signal: controller.signal }),
          api<{ branches: { id: string; name: string }[] }>("/api/branches", { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setData(result); setBranches(branchResult.branches); }
      } catch (error) { if (!controller.signal.aborted) { setData(null); setError(error instanceof Error ? error.message : "Ekstre yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accountId, filters, page, revision]);
  const update = (key: keyof typeof filters, value: string) => { setFilters(old => ({ ...old, [key]: value })); setPage(1); };
  function submit(event: FormEvent) {
    event.preventDefault();
    void mutation.run("/api/current-accounts/" + accountId + "/entries", { ...form, occurredAt: form.occurredAt || undefined });
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/dashboard/accounts" className={secondary}>← Cari hesaplar</Link><button className={secondary} disabled={!data || mutation.busy || mutation.pending} onClick={() => setEditing(!editing)}>Cari bilgilerini düzenle</button></div>
    <Notice error={error || mutation.error} message={message}/>
    {mutation.pending && <div role="status" className={panel + " space-y-3"}><p className="text-sm">Gönderilen hareketin sonucu henüz doğrulanmadı. Yeni işlemden önce aynı isteği doğrulayın.</p><button className={button} disabled={mutation.busy} onClick={() => void mutation.run()}>{mutation.busy ? "Doğrulanıyor…" : "Bekleyen işlemi doğrula"}</button></div>}
    {data && <>
      <section className={panel}>
        <p className="text-sm text-primary">{data.account.code} · {types[data.account.type]} · {data.account.isActive ? "Aktif" : "Pasif"}</p><h1 className="mt-1 break-words text-2xl font-bold">{data.account.name}</h1>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><p>Telefon: {data.account.phone || "—"}</p><p className="break-words">E-posta: {data.account.email || "—"}</p><p>Vergi dairesi: {data.account.taxOffice || "—"}</p><p>Vergi no / TCKN: {data.account.taxNumber || "—"}</p><p className="break-words sm:col-span-2">Adres: {data.account.address || "—"}</p><p className="break-words sm:col-span-2">{data.account.description}</p><p>Oluşturulma: {date(data.account.createdAt)}</p></div>
      </section>
      {editing && <CardForm key={data.account.id + revision} card={data.account} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setRevision(value => value + 1); setMessage("Cari bilgileri güncellendi."); }}/>}
      <div className="grid gap-4 sm:grid-cols-3"><Stat tone="rose" title="Toplam borç hareketi" value={money(data.summary.totalDebit)}/><Stat tone="green" title="Toplam alacak hareketi" value={money(data.summary.totalCredit)}/><Stat title={side(data.summary.balance)} value={money(data.summary.balance)}/></div>
      <p className="text-xs text-muted-foreground">Bakiyeler seçili / yetkili şubeleri kapsar. Borç − alacak = net bakiye; pozitif bakiye işletmenin alacağını gösterir. Açılış tutarları toplam hareketlere dahildir.</p>
      <section className={panel + " space-y-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Cari ekstresi</h2><div className="flex flex-wrap gap-2"><a className={secondary} href={"/api/current-accounts/" + accountId + "/statement.csv?" + params}>CSV dışa aktar</a><button className={button} disabled={!data.account.isActive || mutation.pending || mutation.busy} onClick={() => setShowEntry(!showEntry)}>+ Manuel hareket</button></div></div>
        {showEntry && <form onSubmit={submit} className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <fieldset disabled={mutation.pending || mutation.busy} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Şube<select required className={input} value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })}><option value="">Şube seçin</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label className="text-sm">İşlem türü<select className={input} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="OPENING">Açılış bakiyesi</option><option value="ADJUSTMENT">Manuel düzeltme</option></select></label>
            <label className="text-sm">Borç / alacak<select className={input} value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option value="DEBIT">Borç — işletme alacağını artırır</option><option value="CREDIT">Alacak — işletme borcunu artırır</option></select></label>
            <label className="text-sm">Tutar (TL)<input required type="number" min="0.01" step="0.01" max="999999999999.99" className={input} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
            <label className="text-sm">İşlem tarihi<input type="date" className={input} value={form.occurredAt} onChange={e => setForm({ ...form, occurredAt: e.target.value })}/></label>
            <label className="text-sm">Referans / belge no<input maxLength={100} className={input} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}/></label>
            <label className="text-sm sm:col-span-2">Açıklama {form.kind === "ADJUSTMENT" && "(zorunlu)"}<textarea required={form.kind === "ADJUSTMENT"} maxLength={1000} className={input} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
            <p className="text-xs text-muted-foreground sm:col-span-2">Bu kayıt kasa hareketi oluşturmaz. Açılış her şube için bir kez girilir. Hatalı kayıt ters kayıtla düzeltilir.</p><button className={button}>Hareketi kaydet</button>
          </fieldset>
        </form>}
        {reverseId && <form className="space-y-3 rounded-xl border border-amber-500/30 p-4" onSubmit={event => { event.preventDefault(); void mutation.run("/api/current-accounts/" + accountId + "/entries/" + reverseId + "/reverse", { description: reason }); }}><p className="text-sm">Orijinal hareket korunacak; eşit tutarlı karşıt hareket oluşturulacak.</p><label className="block text-sm">Düzeltme gerekçesi<textarea required maxLength={1000} className={input} value={reason} disabled={mutation.busy || mutation.pending} onChange={e => setReason(e.target.value)}/></label><div className="flex gap-2"><button disabled={mutation.busy || mutation.pending} className={button}>Ters kayıt oluştur</button><button type="button" className={secondary} onClick={() => setReverseId(null)}>Vazgeç</button></div></form>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">Hareket ara<input className={input} maxLength={200} placeholder="Açıklama, referans veya kullanıcı" value={filters.q} onChange={e => update("q", e.target.value)}/></label>
          <label className="text-sm">Başlangıç<input type="date" className={input} value={filters.startDate} onChange={e => update("startDate", e.target.value)}/></label><label className="text-sm">Bitiş<input type="date" className={input} value={filters.endDate} onChange={e => update("endDate", e.target.value)}/></label>
          <label className="text-sm">Şube<select className={input} value={filters.branchId} onChange={e => update("branchId", e.target.value)}><option value="">Yetkili tüm şubeler</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="text-sm">Tarih sırası<select className={input} value={filters.sort} onChange={e => update("sort", e.target.value)}><option value="asc">Eskiden yeniye</option><option value="desc">Yeniden eskiye</option></select></label>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3"><p>Tarih öncesi devir: <strong>{money(data.summary.opening)}</strong></p><p>Filtrelenmiş borç: <strong>{money(data.summary.debit)}</strong></p><p>Filtrelenmiş alacak: <strong>{money(data.summary.credit)}</strong></p></div>
        <p className="text-xs text-muted-foreground">İşlem sonrası bakiyeler aramada gizlenen önceki hareketleri de içerir. Devir yalnızca başlangıç tarihinden önceki hareketlerdir.</p>
        {busy && <p role="status" className="text-sm">Ekstre yükleniyor…</p>}
        <div className="overflow-x-auto rounded-xl border border-border" aria-busy={busy}><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-muted/50"><tr>{["Tarih / Şube", "İşlem türü", "Açıklama / Referans", "Borç", "Alacak", "İşlem sonrası bakiye", "Oluşturan", "Düzeltme"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id} className="border-t border-border"><td className="p-3 whitespace-nowrap">{date(entry.occurredAt)}<p className="text-xs text-muted-foreground">{entry.branchName}</p></td><td className="p-3">{kinds[entry.kind]}{entry.reversed && <p className="text-xs text-muted-foreground">Ters kaydedildi</p>}</td><td className="max-w-xs break-words p-3">{entry.description || "—"}<p className="text-xs text-muted-foreground">{entry.reference}</p>{entry.invoiceId && <Link className="text-xs text-primary underline" href={"/dashboard/invoices/"+entry.invoiceId}>Fatura: {entry.invoiceNumber}</Link>}</td><td className="p-3 whitespace-nowrap">{entry.direction === "DEBIT" ? money(entry.amount) : "—"}</td><td className="p-3 whitespace-nowrap">{entry.direction === "CREDIT" ? money(entry.amount) : "—"}</td><td className="p-3 font-semibold whitespace-nowrap">{money(entry.balance)}</td><td className="p-3">{entry.createdByName}</td><td className="p-3">{entry.canReverse ? <button className={secondary} disabled={mutation.pending || mutation.busy} onClick={() => { setReverseId(entry.id); setReason(""); setShowEntry(false); }}>Ters kayıt</button> : entry.reversalOfId ? "Ters kayıt" : "—"}</td></tr>)}</tbody></table>{!data.entries.length && <p className="p-8 text-center text-sm text-muted-foreground">Filtrelere uygun hareket yok.</p>}</div>
        <Pager page={page} pages={data.pagination.totalPages} busy={busy} onChange={setPage}/>
      </section>
    </>}
    {!data && busy && <p role="status" className="text-sm">Cari bilgileri yükleniyor…</p>}
  </div>;
}
