"use client";
import { FinanceBadge } from "@/components/finance/finance-ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, button, secondary, panel, input, money, date, Notice, Stat, Pager } from "@/components/current-accounts/shared";
import { calendarDay, useExpenseMutation } from "@/components/expenses/shared";
import { isCollection, paymentTypes, type PaymentKind } from "@/lib/payments";

type Named = { id: string; name: string };
type Document = { id: string; branchId: string; currentAccountId: string | null; remaining: string; title?: string; number?: string; type?: string };
type Options = { organization: { name: string }; branches: Named[]; accounts: (Named & { branchId: string; isActive: boolean })[]; cards: (Named & { code: string; type: string; isActive: boolean })[]; expenses: Document[]; invoices: Document[] };
type Payment = { id: string; type: PaymentKind; amount: string; paidAt: string; reference: string | null; description: string | null; cancelledAt: string | null; cancellationReason: string | null; financeTransactionId: string; currentAccountEntryId: string | null; reversalFinanceTransactionId: string | null; reversalCurrentAccountEntryId: string | null; branch: Named; currentAccount: Named | null; expense: { id: string; title: string } | null; allocations: { id: string; invoice: { id: string; number: string } }[]; financeTransaction: { account: Named }; createdBy: { name: string | null }; createdByProfile: { name: string } | null; cancelledBy: { name: string | null } | null; cancelledByProfile: { name: string } | null };
type Result = { payments: Payment[]; summary: { count: number; collections: string; payments: string }; pagination: { totalPages: number } };
const initialFilters = { branchId: "", type: "", accountId: "", currentAccountId: "", startDate: "", endDate: "", q: "", status: "active", expenseId: "", invoiceId: "" };
export default function PaymentsManager() {
  const [options, setOptions] = useState<Options | null>(null), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [filters, setFilters] = useState(initialFilters), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [busy, setBusy] = useState(true), [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Payment | null>(null), [reason, setReason] = useState(""), [cancelling, setCancelling] = useState(false), cancelLock = useRef(false);
  const [form, setForm] = useState({ type: "CUSTOMER_COLLECTION" as PaymentKind, branchId: "", currentAccountId: "", expenseId: "", invoiceId: "", accountId: "", amount: "", paidAt: calendarDay(new Date().toISOString()), description: "", reference: "" });
  const supplierPrefilled = useRef(false);
  const done = useCallback(() => { setRevision(n => n + 1); setShowForm(false); setMessage("İşlem kaydedildi. Kasa ve cari etkileri birlikte işlendi."); setForm(f => ({ ...f, amount: "", reference: "", description: "" })); }, []);
  const mutation = useExpenseMutation("/api/payments", done);
  useEffect(() => { const p = new URLSearchParams(window.location.search); const timer = setTimeout(() => { setFilters(f => ({ ...f, expenseId: p.get("expenseId") ?? "", invoiceId: p.get("invoiceId") ?? "", currentAccountId: p.get("currentAccountId") ?? "" })); if (p.get("new") === "1" && p.get("type") === "SUPPLIER_PAYMENT") { setForm(f => ({ ...f, type: "SUPPLIER_PAYMENT", currentAccountId: p.get("currentAccountId") ?? "" })); setShowForm(true); } }, 0); return () => clearTimeout(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const params = new URLSearchParams({ ...filters, page: String(page), limit: "20" });
        const [data, choices] = await Promise.all([api<Result>("/api/payments?" + params, { signal: controller.signal }), api<Options>("/api/payments/options", { signal: controller.signal })]);
        if (!controller.signal.aborted) {
          setResult(data); setOptions(choices);
          const params = new URLSearchParams(window.location.search), cardId = params.get("currentAccountId");
          if (!supplierPrefilled.current && params.get("new") === "1" && params.get("type") === "SUPPLIER_PAYMENT" && cardId) {
            supplierPrefilled.current = true;
            const scoped = (d: Document) => d.currentAccountId === cardId && Number(d.remaining) > 0 && (!params.get("branchId") || d.branchId === params.get("branchId"));
            const invoice = choices.invoices.find(d => d.type === "PURCHASE" && scoped(d));
            const expense = choices.expenses.find(scoped);
            setForm(f => ({ ...f, currentAccountId: cardId, ...(invoice ? { type: "PURCHASE_INVOICE_PAYMENT", invoiceId: invoice.id, branchId: invoice.branchId } : expense ? { type: "EXPENSE_PAYMENT", expenseId: expense.id, branchId: expense.branchId } : { type: "SUPPLIER_PAYMENT", branchId: params.get("branchId") ?? (choices.branches.length === 1 ? choices.branches[0].id : "") }) }));
          }
        }
      } catch (e) { if (!controller.signal.aborted) { setResult(null); setError(e instanceof Error ? e.message : "Ödemeler yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, page, revision]);
  function filter(key: keyof typeof filters, value: string) { setFilters(f => ({ ...f, [key]: value })); setPage(1); }
  const incoming = isCollection(form.type), documentType = form.type === "EXPENSE_PAYMENT" ? "expense" : form.type.includes("INVOICE") ? "invoice" : null;
  const documents = (documentType === "expense" ? options?.expenses : options?.invoices)?.filter(d => d.branchId === form.branchId && Number(d.remaining) > 0 && (documentType === "expense" || d.type === (incoming ? "SALES" : "PURCHASE"))) ?? [];
  const selectedDocument = documents.find(d => d.id === (documentType === "expense" ? form.expenseId : form.invoiceId));
  const locked = mutation.busy || mutation.pending;
  function submit(e: FormEvent) { e.preventDefault(); void mutation.run({ ...form, currentAccountId: documentType ? selectedDocument?.currentAccountId ?? "" : form.currentAccountId }); }
  async function cancel() {
    if (!detail || cancelLock.current) return; cancelLock.current = true; setCancelling(true); setError("");
    try { const response = await api<{ payment: Payment }>(`/api/payments/${detail.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); setDetail({ ...detail, ...response.payment }); setRevision(n => n + 1); setReason(""); setMessage("Ödeme iptal edildi; ters kayıtlar oluşturuldu."); }
    catch (e) { setError(e instanceof Error ? e.message : "İptal tamamlanamadı."); }
    finally { cancelLock.current = false; setCancelling(false); }
  }
  return <div className="space-y-5"><Notice error={error || mutation.error} message={message}/>
    <p className="text-sm text-muted-foreground">{options?.organization.name} · Tahsilatlar ve ödemeler kasa ile cari hesaplara birlikte işlenir. MVP’de avans desteklenmez.</p>
    <div className="grid gap-4 sm:grid-cols-3"><Stat tone="green" title="Toplam tahsilatlar (aktif)" value={money(result?.summary.collections)}/><Stat tone="rose" title="Toplam ödemeler (aktif)" value={money(result?.summary.payments)}/><Stat tone="violet" title="Filtrelenen işlem sayısı" value={String(result?.summary.count ?? 0)}/></div>
    <button className={button} disabled={!options || locked} onClick={() => setShowForm(v => !v)}>Yeni ödeme / tahsilat</button>
    {mutation.pending && <div className={panel}><p className="mb-3 text-sm">Sonucu belirsiz isteği aynı anahtarla doğrulayın.</p><button className={button} disabled={mutation.busy} onClick={() => void mutation.run()}>Bekleyen işlemi doğrula</button></div>}
    {showForm && options && <form className={panel + " space-y-4"} onSubmit={submit}><h2 className="text-lg font-bold">Yeni işlem</h2><fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">İşletme<input className={input} value={options.organization.name} readOnly/></label>
      <label className="text-sm">İşlem türü<select className={input} value={form.type} onChange={e => setForm({ ...form, type: e.target.value as PaymentKind, currentAccountId: "", expenseId: "", invoiceId: "" })}>{Object.entries(paymentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="text-sm">Şube<select required className={input} value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value, accountId: "", expenseId: "", invoiceId: "" })}><option value="">Şube seçin</option>{options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      {documentType ? <label className="text-sm">{documentType === "expense" ? "Gider" : "Kesin fatura"}<select required className={input} value={documentType === "expense" ? form.expenseId : form.invoiceId} onChange={e => setForm({ ...form, expenseId: documentType === "expense" ? e.target.value : "", invoiceId: documentType === "invoice" ? e.target.value : "" })}><option value="">Belge seçin</option>{documents.map(d => <option key={d.id} value={d.id}>{d.title ?? d.number} · Kalan {money(d.remaining)}</option>)}</select><span>{selectedDocument?.currentAccountId ? "Cari: " + options.cards.find(c => c.id === selectedDocument.currentAccountId)?.name : ""}</span></label> : <label className="text-sm">Cari hesap<select required className={input} value={form.currentAccountId} onChange={e => setForm({ ...form, currentAccountId: e.target.value })}><option value="">Cari seçin</option>{options.cards.filter(c => c.isActive && (c.type === "BOTH" || c.type === (incoming ? "CUSTOMER" : "SUPPLIER"))).map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>}
      <label className="text-sm">Nakit / banka hesabı<select required className={input} value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })}><option value="">Hesap seçin</option>{options.accounts.filter(a => a.isActive && a.branchId === form.branchId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm">Tutar (TL)<input className={input} required type="number" min="0.01" step="0.01" max={selectedDocument?.remaining} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
      <label className="text-sm">İşlem tarihi<input className={input} required type="date" max={calendarDay(new Date().toISOString())} value={form.paidAt} onChange={e => setForm({ ...form, paidAt: e.target.value })}/></label>
      <label className="text-sm">Referans numarası<input className={input} maxLength={100} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}/></label>
      <label className="text-sm sm:col-span-2">Açıklama<textarea className={input} maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
      <button className={button}>{mutation.busy ? "Kaydediliyor…" : "Kaydet"}</button>
    </fieldset><p className="text-xs text-muted-foreground">Belgeye ait açık tutarı kapatırken ilgili fatura/gider türünü seçin. Kasa transferleri ve POS satışları bu listede yeniden kaydedilmez.</p></form>}
    <section className={panel + " grid gap-3 sm:grid-cols-2 lg:grid-cols-4"} aria-label="Ödeme filtreleri">
      <label className="text-sm">Şube<select className={input} value={filters.branchId} onChange={e => filter("branchId", e.target.value)}><option value="">Tüm şubeler</option>{options?.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-sm">Tür<select className={input} value={filters.type} onChange={e => filter("type", e.target.value)}><option value="">Tüm türler</option>{Object.entries(paymentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="text-sm">Hesap<select className={input} value={filters.accountId} onChange={e => filter("accountId", e.target.value)}><option value="">Tüm hesaplar</option>{options?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm">Cari<select className={input} value={filters.currentAccountId} onChange={e => filter("currentAccountId", e.target.value)}><option value="">Tüm cariler</option>{options?.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-sm">Başlangıç<input className={input} type="date" value={filters.startDate} onChange={e => filter("startDate", e.target.value)}/></label><label className="text-sm">Bitiş<input className={input} type="date" value={filters.endDate} onChange={e => filter("endDate", e.target.value)}/></label>
      <label className="text-sm">Referans ara<input className={input} maxLength={100} value={filters.q} onChange={e => filter("q", e.target.value)}/></label><label className="text-sm">Durum<select className={input} value={filters.status} onChange={e => filter("status", e.target.value)}><option value="active">Aktif</option><option value="cancelled">İptal</option><option value="all">Tümü</option></select></label>
      {(filters.expenseId || filters.invoiceId) && <button className={secondary} onClick={() => { setFilters(initialFilters); setPage(1); }}>Belge filtresini temizle</button>}
    </section>
    {busy && <p role="status">Yükleniyor…</p>}
    {result && <><div className={panel + " overflow-x-auto"}><table className="w-full min-w-[850px] text-left text-sm"><thead><tr>{["Tarih", "Tür / Şube", "Cari / Hesap", "Tutar", "Referans", "Durum", ""].map((t, n) => <th key={n} className="p-3">{t}</th>)}</tr></thead><tbody>{result.payments.map(p => <tr key={p.id} className="border-t border-border"><td className="p-3">{date(p.paidAt)}</td><td className="p-3">{paymentTypes[p.type]}<p className="text-xs text-muted-foreground">{p.branch.name}</p></td><td className="p-3">{p.currentAccount?.name ?? "—"}<p className="text-xs text-muted-foreground">{p.financeTransaction.account.name}</p></td><td className={"whitespace-nowrap p-3 font-semibold " + (isCollection(p.type) ? "text-emerald-700" : "text-rose-600")}>{isCollection(p.type) ? "+" : "−"}{money(p.amount)}</td><td className="max-w-48 break-words p-3">{p.reference ?? "—"}</td><td className="p-3"><FinanceBadge tone={p.cancelledAt ? "neutral" : "green"}>{p.cancelledAt ? "İptal" : "Aktif"}</FinanceBadge></td><td className="p-3"><button className={secondary} onClick={() => { setDetail(p); setReason(""); }}>Detay</button></td></tr>)}</tbody></table>{!result.payments.length && <p className="p-8 text-center text-muted-foreground">Bu filtrelerde işlem bulunamadı.</p>}</div><Pager page={page} pages={result.pagination.totalPages} busy={busy} onChange={setPage}/></>}
    {detail && <section className={panel + " space-y-3 break-words"}><div className="flex justify-between gap-3"><h2 className="text-lg font-bold">{paymentTypes[detail.type]} · {money(detail.amount)}</h2><button className={secondary} onClick={() => setDetail(null)}>Kapat</button></div><p>{date(detail.paidAt)} · {detail.reference} · {detail.description}</p><p className="text-sm">Oluşturan: {detail.createdByProfile?.name ?? detail.createdBy.name ?? "Kullanıcı"}</p><div className="flex flex-wrap gap-3 text-sm text-primary underline">{detail.currentAccount && <Link href={"/dashboard/accounts/" + detail.currentAccount.id}>Cari: {detail.currentAccount.name}</Link>}{detail.expense && <Link href={"/dashboard/expenses/" + detail.expense.id}>Gider: {detail.expense.title}</Link>}{detail.allocations.map(a => <Link key={a.id} href={"/dashboard/invoices/" + a.invoice.id}>Fatura: {a.invoice.number}</Link>)}</div><p className="text-xs text-muted-foreground">Kasa kaydı: {detail.financeTransactionId}<br/>Cari kaydı: {detail.currentAccountEntryId ?? "Yok"}</p>
      {detail.cancelledAt ? <div className="text-sm"><p>İptal: {date(detail.cancelledAt)} · {detail.cancelledByProfile?.name ?? detail.cancelledBy?.name} · {detail.cancellationReason}</p><p className="text-xs">Ters kasa: {detail.reversalFinanceTransactionId}<br/>Ters cari: {detail.reversalCurrentAccountEntryId ?? "Yok"}</p></div> : <><p className="text-sm text-muted-foreground">İptal yalnız WellPOS içindeki finansal kayıtları düzeltir. Banka transferi veya kart işlemi geri alınmaz. Düzeltme için iptal sonrası yeni işlem kaydedin.</p><label className="block text-sm">İptal gerekçesi<textarea className={input} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button className={secondary + " finance-danger"} disabled={cancelling || !reason.trim()} onClick={() => void cancel()}>Ödemeyi iptal et</button></>}
    </section>}
  </div>;
}
