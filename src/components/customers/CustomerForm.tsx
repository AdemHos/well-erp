"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, button, secondary, panel, input, Notice, customerTypes, type Customer, type CustomerOptions } from "./shared";
import { useExpenseMutation } from "@/components/expenses/shared";

export default function CustomerForm({ customer, organizationId, canFinance, onSaved, onCancel }: { customer?: Customer; organizationId: string; canFinance: boolean; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ type: customer?.type ?? "INDIVIDUAL", name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", address: customer?.address ?? "", city: customer?.city ?? "", district: customer?.district ?? "", taxOffice: customer?.taxOffice ?? "", taxNumber: customer?.taxNumber ?? "", notes: customer?.notes ?? "", isActive: customer?.isActive ?? true });
  const [mode, setMode] = useState("none"), [currentAccountId, setAccountId] = useState(""), [query, setQuery] = useState(""), [options, setOptions] = useState<CustomerOptions>({ accounts: [], canFinance }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const done = useCallback(() => onSaved(), [onSaved]);
  const mutation = useExpenseMutation("/api/customers", done, !customer, organizationId);
  const searchQuery = query || form.taxNumber || form.phone || form.email || (form.name.trim().length >= 2 ? form.name : "");
  useEffect(() => {
    if (customer || !canFinance) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { void api<CustomerOptions>("/api/customers/options?q=" + encodeURIComponent(searchQuery), { signal: controller.signal }).then(o => { if (!controller.signal.aborted) { setOptions(o); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, customer, canFinance]);
  const locked = busy || mutation.busy || mutation.pending;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer) { void mutation.run({ ...form, expectedOrganizationId: organizationId, accountMode: mode, currentAccountId: mode === "existing" ? currentAccountId : null }); return; }
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await api("/api/customers/" + customer.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, expectedVersion: customer.version }) }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Müşteri kaydedilemedi."); }
    finally { lock.current = false; setBusy(false); }
  }
  function selectAccount(id: string) {
    setAccountId(id);
    const card = options.accounts.find(a => a.id === id);
    if (card) setForm(f => ({ ...f, name: card.name, phone: card.phone ?? "", email: card.email ?? "", address: card.address ?? "", ...(f.type === "CORPORATE" ? { taxOffice: card.taxOffice ?? "", taxNumber: card.taxNumber?.length === 10 ? card.taxNumber : "" } : {}) }));
  }
  return <form className={panel + " space-y-5"} onSubmit={submit}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">{customer ? "Müşteri bilgilerini düzenle" : "Yeni müşteri"}</h2><button type="button" className={secondary} disabled={locked} onClick={onCancel}>Kapat</button></div><Notice error={error || mutation.error}/>
    {mutation.pending && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><p>İşlemin sonucu henüz doğrulanmadı. Yeni kayıt açmadan aynı isteği doğrulayın.</p><button className={secondary + " mt-3"} type="button" disabled={mutation.busy} onClick={() => void mutation.run()}>Bekleyen kaydı doğrula</button></div>}
    <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Müşteri türü<select className={input} value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Customer["type"], taxOffice: "", taxNumber: "" })}>{Object.entries(customerTypes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      {!customer && canFinance && <label className="text-sm">Cari hesap<select className={input} value={mode} onChange={e => { setMode(e.target.value); setAccountId(""); }}><option value="none">Cari açmadan müşteri oluştur</option><option value="existing">Mevcut müşteri carisini bağla</option><option value="create">Müşteriyle birlikte yeni cari aç</option></select></label>}
      {!customer && canFinance && <label className="text-sm sm:col-span-2">Mevcut müşteri / cari eşleşmelerini ara<input className={input} placeholder="Kod, ad, telefon, e-posta veya vergi numarası" value={query} onChange={e => setQuery(e.target.value)} maxLength={100}/></label>}
      {!customer && mode === "existing" && <label className="text-sm sm:col-span-2">Bağlanacak müşteri carisi<select className={input} required value={currentAccountId} onChange={e => selectAccount(e.target.value)}><option value="">Cari seçin; gerekirse yukarıdan arayın</option>{options.accounts.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Seçtiğiniz carinin bilgileri başlangıç için forma alınır. Müşteri türünü kontrol edin. Cari bilgileri üzerine yazılmaz.</span></label>}
      <div className="text-sm">Müşteri kodu<div className={input + " bg-slate-50 text-slate-500"}>{customer?.code ?? "Kaydedildiğinde otomatik oluşturulur"}</div></div>
      <label className="text-sm">{form.type === "CORPORATE" ? "Şirket unvanı" : "Ad soyad"}<input className={input} required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
      <label className="text-sm">Telefon<input type="tel" className={input} maxLength={40} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>
      <label className="text-sm">E-posta<input type="email" className={input} maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
      <label className="text-sm">İl<input className={input} maxLength={100} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></label>
      <label className="text-sm">İlçe<input className={input} maxLength={100} value={form.district} onChange={e => setForm({ ...form, district: e.target.value })}/></label>
      <label className="text-sm sm:col-span-2">Adres<textarea className={input} maxLength={1000} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></label>
      {form.type === "CORPORATE" && <><label className="text-sm">Vergi dairesi<input className={input} maxLength={100} value={form.taxOffice} onChange={e => setForm({ ...form, taxOffice: e.target.value })}/></label><label className="text-sm">Vergi numarası<input className={input} inputMode="numeric" maxLength={10} value={form.taxNumber} onChange={e => setForm({ ...form, taxNumber: e.target.value })}/></label></>}
      <label className="text-sm sm:col-span-2">Açıklama / notlar<textarea className={input} maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })}/>Aktif müşteri</label>
    </fieldset>
    {!customer && !!options.matches?.length && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="mb-2 font-semibold">Benzer kayıtlar var. Aynı müşteri için yeni profil açmayın.</p>{options.matches.map(c => <Link className="mr-4 inline-block underline" key={c.id} href={"/dashboard/customers/" + c.id}>{c.code} · {c.name}</Link>)}</div>}
    <p className="text-xs leading-5 text-slate-500">Telefon, adres, e-posta ve vergi alanları isteğe bağlıdır. Müşteri profili ve bağlı finans kartı otomatik olarak birbirinin bilgilerini değiştirmez.</p><button className={button} disabled={locked}>{busy || mutation.busy ? "Kaydediliyor…" : "Müşteriyi kaydet"}</button>
  </form>;
}
