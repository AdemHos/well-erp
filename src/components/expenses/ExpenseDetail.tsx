"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import ExpenseForm from "./ExpenseForm";
import { api, button, calendarDay, date, input, money, Notice, panel, secondary, Stat, statuses, useExpenseMutation, type Branch, type Category, type ExpenseDetail as Detail } from "./shared";

type CashAccount = { id: string; name: string; branchId: string; type: "CASH" | "CARD" | "BANK"; balance: string; isActive: boolean };
export default function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const [data, setData] = useState<Detail | null>(null), [accounts, setAccounts] = useState<CashAccount[]>([]), [categories, setCategories] = useState<Category[]>([]), [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false), [showPayment, setShowPayment] = useState(false), [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState(""), [cancelling, setCancelling] = useState(false), cancelLock = useRef(false);
  const [form, setForm] = useState({ accountId: "", amount: "", paidAt: calendarDay(new Date().toISOString()), description: "", reference: "" });
  const refresh = useCallback(() => { setRevision(value => value + 1); setShowPayment(false); setMessage("Ödeme kaydedildi. Kasa ve varsa cari hareketi birlikte oluşturuldu."); setForm(value => ({ ...value, amount: "", description: "", reference: "" })); }, []);
  const mutation = useExpenseMutation("/api/expenses/" + expenseId + "/payments", refresh);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const [result, accountData, categoryData, branchData] = await Promise.all([
          api<{ expense: Detail }>("/api/expenses/" + expenseId, { signal: controller.signal }),
          api<{ accounts: CashAccount[] }>("/api/finance/accounts", { signal: controller.signal }),
          api<{ categories: Category[] }>("/api/finance/categories?direction=OUT", { signal: controller.signal }),
          api<{ branches: Branch[] }>("/api/branches", { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setData(result.expense); setAccounts(accountData.accounts); setCategories(categoryData.categories); setBranches(branchData.branches); }
      } catch (error) { if (!controller.signal.aborted) { setData(null); setError(error instanceof Error ? error.message : "Gider yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 100);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [expenseId, revision]);
  function submitPayment(event: FormEvent) { event.preventDefault(); void mutation.run(form); }
  async function cancel(event: FormEvent) {
    event.preventDefault(); if (!data || cancelLock.current) return; cancelLock.current = true; setCancelling(true); setError("");
    try { await api("/api/expenses/" + expenseId + "/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: data.version, reason }) }); setShowCancel(false); setRevision(value => value + 1); setMessage("Gider iptal edildi; varsa cari tahakkuku ters kaydedildi."); }
    catch (error) { setError(error instanceof Error ? error.message : "İptal tamamlanamadı."); }
    finally { cancelLock.current = false; setCancelling(false); }
  }
  const eligible = accounts.filter(account => account.branchId === data?.branchId && account.isActive && account.type !== "CARD");
  const locked = mutation.pending || mutation.busy || cancelling;
  return <div className="space-y-5"><Link className={secondary} href="/dashboard/expenses">← Giderler</Link><Notice error={error || mutation.error} message={message}/>
    {mutation.pending && <div role="status" className={panel + " space-y-3"}><p className="text-sm">Ödemenin sonucu henüz doğrulanmadı. Yeni ödeme yapmadan önce aynı isteği doğrulayın.</p><button className={button} disabled={mutation.busy} onClick={() => void mutation.run()}>Bekleyen ödemeyi doğrula</button></div>}
    {busy && <p role="status" className="text-sm text-muted-foreground">Gider yükleniyor…</p>}
    {data && <><section className={panel + " space-y-3"}><p className="text-sm text-primary">{data.branch.name} · {data.category.name} · {data.cancelledAt ? "İptal edildi" : statuses[data.paymentStatus]}</p><h1 className="break-words text-2xl font-bold">{data.title}</h1><div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><p>Gider tarihi: {calendarDay(data.expenseDate)}</p><p>Son ödeme tarihi: {calendarDay(data.dueDate) || "—"}</p><p className="break-words">Referans: {data.reference || "—"}</p><p>{data.currentAccount ? <Link className="underline" href={"/dashboard/accounts/" + data.currentAccount.id}>Cari: {data.currentAccount.name}</Link> : "Cari bağlantısı yok"}</p><p className="break-words sm:col-span-2">{data.description}</p></div>{data.cancelledAt && <p className="text-sm">İptal: {date(data.cancelledAt)} · {data.cancellationReason}</p>}</section>
      <div className="grid gap-4 sm:grid-cols-3"><Stat tone="rose" title="Gider tutarı" value={money(data.amount)}/><Stat tone="green" title="Ödenen" value={money(data.paidAmount)}/><Stat tone="amber" title="Kalan bakiye" value={money(data.remainingAmount)}/></div>
      {!data.cancelledAt && <div className="flex flex-wrap gap-3"><button className={secondary} disabled={locked} onClick={() => { setEditing(!editing); setShowPayment(false); setShowCancel(false); }}>Düzenle</button><button className={button} disabled={locked || data.paymentStatus === "PAID"} onClick={() => { setShowPayment(!showPayment); setEditing(false); setShowCancel(false); }}>Ödeme kaydet</button><button className={secondary + " finance-danger"} disabled={locked || Number(data.paidAmount) > 0} onClick={() => { setShowCancel(!showCancel); setEditing(false); setShowPayment(false); }}>Ödemesiz gideri iptal et</button></div>}
      {editing && <ExpenseForm key={data.version} expense={data} categories={categories} branches={branches} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setRevision(value => value + 1); setMessage("Gider güncellendi; finansal geçmiş korundu."); }}/>}
      {showCancel && <form onSubmit={cancel} className={panel + " space-y-3"}><h2 className="font-bold">Gider iptali</h2><p className="text-sm text-muted-foreground">Kayıt silinmeyecek. Varsa tedarikçi borcu karşıt cari hareketiyle kapatılacak.</p><label className="block text-sm">İptal gerekçesi<textarea className={input} required maxLength={1000} disabled={locked} value={reason} onChange={e => setReason(e.target.value)}/></label><button className={button} disabled={locked}>İptali kaydet</button></form>}
      {showPayment && <form onSubmit={submitPayment} className={panel + " space-y-4"}><h2 className="text-lg font-bold">Gider ödemesi</h2><fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Ödeme hesabı<select className={input} required value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })}><option value="">Aynı şubede nakit / banka hesabı seçin</option>{eligible.map(a => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}</select></label>
        <label className="text-sm">Ödenecek tutar (TL)<input className={input} required type="number" min="0.01" step="0.01" max={data.remainingAmount} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
        <label className="text-sm">Ödeme tarihi<input className={input} required type="date" max={calendarDay(new Date().toISOString())} value={form.paidAt} onChange={e => setForm({ ...form, paidAt: e.target.value })}/></label>
        <label className="text-sm">Referans<input className={input} maxLength={100} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}/></label>
        <label className="text-sm">Açıklama<input className={input} maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
        <p className="text-xs text-muted-foreground sm:col-span-2">Kalan: {money(data.remainingAmount)}. Kasa çıkışı ve varsa cari borç azaltımı birlikte kaydedilir. POS tahsilat hesabı ödeme aracı değildir.</p><button className={button} disabled={!eligible.length}>Ödemeyi kaydet</button>
      </fieldset>{!eligible.length && <p className="text-sm text-amber-700">Bu şubede aktif nakit veya banka hesabı yok. Kasa bölümünden uygun hesap oluşturun.</p>}</form>}
      <section className={panel + " space-y-4"}><h2 className="text-lg font-bold">Ödeme geçmişi</h2><Link className={secondary} href={"/dashboard/payments?expenseId="+expenseId}>Merkezi ödeme listesi / iptal</Link><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/50"><tr>{["Tarih", "Hesap", "Tutar", "Açıklama / Referans", "Oluşturan"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{data.payments.map(payment => <tr key={payment.id} className="border-t border-border"><td className="whitespace-nowrap p-3">{date(payment.paidAt)}</td><td className="p-3">{payment.financeTransaction.account.name}</td><td className="whitespace-nowrap p-3 font-semibold">{money(payment.amount)}{payment.cancelledAt && <p className="text-xs">İptal edildi</p>}</td><td className="max-w-xs break-words p-3">{payment.description || "—"}<p className="text-xs text-muted-foreground">{payment.reference}</p></td><td className="p-3">{payment.createdByProfile?.name || payment.createdBy.name || "Kullanıcı"}</td></tr>)}</tbody></table>{!data.payments.length && <p className="p-8 text-center text-sm text-muted-foreground">Henüz ödeme yok. Gider kaydı tek başına kasa bakiyesini değiştirmez.</p>}</div><p className="text-xs text-muted-foreground">Geçmiş ödemeler düzenlenmez veya silinmez. Hatalı ödemeler merkezi ödeme listesinden ters kayıtla iptal edilir.</p></section>
    </>}
  </div>;
}
