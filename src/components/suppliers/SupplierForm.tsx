"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, button, secondary, panel, input, Notice, type Supplier, type SupplierOptions } from "./shared";
import { useExpenseMutation } from "@/components/expenses/shared";

export default function SupplierForm({ supplier, organizationId, canFinance, onSaved, onCancel }: { supplier?: Supplier; organizationId: string; canFinance: boolean; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ code: supplier?.code ?? "", contactName: supplier?.contactName ?? "", website: supplier?.website ?? "", name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", city: supplier?.city ?? "", district: supplier?.district ?? "", taxOffice: supplier?.taxOffice ?? "", taxNumber: supplier?.taxNumber ?? "", notes: supplier?.notes ?? "", isActive: supplier?.isActive ?? true });
  const [mode, setMode] = useState("none"), [currentAccountId, setAccountId] = useState(""), [query, setQuery] = useState(""), [options, setOptions] = useState<SupplierOptions>({ accounts: [], canFinance }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const done = useCallback(() => onSaved(), [onSaved]);
  const mutation = useExpenseMutation("/api/suppliers", done, !supplier, organizationId);
  const searchQuery = query || form.taxNumber || form.phone || form.email || (form.name.trim().length >= 2 ? form.name : "");
  useEffect(() => {
    if (supplier || !canFinance) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { void api<SupplierOptions>("/api/suppliers/options?q=" + encodeURIComponent(searchQuery), { signal: controller.signal }).then(o => { if (!controller.signal.aborted) { setOptions(o); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, supplier, canFinance]);
  const locked = busy || mutation.busy || mutation.pending;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supplier) { void mutation.run({ ...form, expectedOrganizationId: organizationId, accountMode: mode, currentAccountId: mode === "existing" ? currentAccountId : null }); return; }
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await api("/api/suppliers/" + supplier.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, expectedVersion: supplier.version }) }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Tedarikçi kaydedilemedi."); }
    finally { lock.current = false; setBusy(false); }
  }
  function selectAccount(id: string) {
    setAccountId(id);
    const card = options.accounts.find(a => a.id === id);
    if (card) setForm(f => ({ ...f, name: card.name, phone: card.phone ?? "", email: card.email ?? "", address: card.address ?? "", taxOffice: card.taxOffice ?? "", taxNumber: card.taxNumber ?? "" }));
  }
  return <form className={panel + " space-y-5"} onSubmit={submit}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">{supplier ? "Tedarikçi bilgilerini düzenle" : "Yeni tedarikçi"}</h2><button type="button" className={secondary} disabled={locked} onClick={onCancel}>Kapat</button></div><Notice error={error || mutation.error}/>
    {mutation.pending && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p>İşlemin sonucu henüz doğrulanmadı. Yeni kayıt açmadan aynı isteği doğrulayın.</p><button className={secondary + " mt-3"} type="button" disabled={mutation.busy} onClick={() => void mutation.run()}>Bekleyen kaydı doğrula</button></div>}
    <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      {!supplier && canFinance && <label className="text-sm">Cari hesap<select className={input} value={mode} onChange={e => { setMode(e.target.value); setAccountId(""); }}><option value="none">Cari açmadan tedarikçi oluştur</option><option value="existing">Mevcut tedarikçi carisini bağla</option><option value="create">Tedarikçiyle birlikte yeni cari aç</option></select></label>}
      {!supplier && canFinance && <label className="text-sm sm:col-span-2">Mevcut tedarikçi / cari eşleşmelerini ara<input className={input} placeholder="Kod, ad, telefon, e-posta veya vergi numarası" value={query} onChange={e => setQuery(e.target.value)} maxLength={100}/></label>}
      {!supplier && mode === "existing" && <label className="text-sm sm:col-span-2">Bağlanacak tedarikçi carisi<select className={input} required value={currentAccountId} onChange={e => selectAccount(e.target.value)}><option value="">Cari seçin; gerekirse yukarıdan arayın</option>{options.accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Seçtiğiniz carinin bilgileri başlangıç için forma alınır. Cari bilgileri üzerine yazılmaz.</span></label>}
      <label className="text-sm">Tedarikçi kodu<input className={input} maxLength={40} placeholder="Boşsa otomatik oluşturulur" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}/></label>
      <label className="text-sm">Firma / ticari unvan<input className={input} required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
      <label className="text-sm">Yetkili kişi<input className={input} maxLength={200} value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })}/></label>
      <label className="text-sm">Web sitesi<input type="url" className={input} maxLength={500} value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}/></label>
      <label className="text-sm">Telefon<input type="tel" className={input} maxLength={40} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>
      <label className="text-sm">E-posta<input type="email" className={input} maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
      <label className="text-sm">İl<input className={input} maxLength={100} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></label>
      <label className="text-sm">İlçe<input className={input} maxLength={100} value={form.district} onChange={e => setForm({ ...form, district: e.target.value })}/></label>
      <label className="text-sm sm:col-span-2">Adres<textarea className={input} maxLength={1000} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></label>
      <><label className="text-sm">Vergi dairesi<input className={input} maxLength={100} value={form.taxOffice} onChange={e => setForm({ ...form, taxOffice: e.target.value })}/></label><label className="text-sm">Vergi numarası / TCKN<input className={input} inputMode="numeric" maxLength={11} value={form.taxNumber} onChange={e => setForm({ ...form, taxNumber: e.target.value })}/></label></>
      <label className="text-sm sm:col-span-2">Açıklama / notlar<textarea className={input} maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })}/>Aktif tedarikçi</label>
    </fieldset>
    {!supplier && !!options.matches?.length && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="mb-2 font-semibold">Benzer kayıtlar var. Aynı tedarikçi için yeni profil açmayın.</p>{options.matches.map(c => <Link className="mr-4 inline-block underline" key={c.id} href={"/dashboard/suppliers/" + c.id}>{c.code} · {c.name}</Link>)}</div>}
    <p className="text-xs leading-5 text-slate-500">Telefon, adres, e-posta ve vergi alanları isteğe bağlıdır. Tedarikçi profili ve bağlı finans kartı otomatik olarak birbirinin bilgilerini değiştirmez.</p><button className={button} disabled={locked}>{busy || mutation.busy ? "Kaydediliyor…" : "Tedarikçiyi kaydet"}</button>
  </form>;
}
