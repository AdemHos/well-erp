"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, button, calendarDay, input, Notice, panel, secondary, useExpenseMutation, type Branch, type Category, type ExpenseDetail, type ExpenseRow, type Supplier } from "./shared";

export default function ExpenseForm({ expense, branches, categories, onSaved, onCancel }: { expense?: ExpenseDetail; branches: Branch[]; categories: Category[]; onSaved: (expense?: ExpenseRow) => void; onCancel: () => void }) {
  const initial = { title: expense?.title ?? "", categoryId: expense?.categoryId ?? "", branchId: expense?.branchId ?? "", amount: expense?.amount ?? "", expenseDate: calendarDay(expense?.expenseDate) || calendarDay(new Date().toISOString()), dueDate: calendarDay(expense?.dueDate), description: expense?.description ?? "", reference: expense?.reference ?? "", currentAccountId: expense?.currentAccountId ?? "" };
  const [form, setForm] = useState(initial), [reason, setReason] = useState("");
  const [supplierQuery, setSupplierQuery] = useState(""), [suppliers, setSuppliers] = useState<Supplier[]>([]), [supplierError, setSupplierError] = useState("");
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), lock = useRef(false);
  const mutation = useExpenseMutation("/api/expenses", result => onSaved(result.expense), !expense);
  const paid = !!expense && Number(expense.paidAmount) > 0;
  const busy = saving || mutation.busy, blocked = busy || mutation.pending;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try { const data = await api<{ accounts: Supplier[] }>("/api/current-accounts?type=SUPPLIER&active=true&limit=100&q=" + encodeURIComponent(supplierQuery), { signal: controller.signal }); if (!controller.signal.aborted) { setSuppliers(data.accounts); setSupplierError(""); } }
      catch (error) { if (!controller.signal.aborted) setSupplierError(error instanceof Error ? error.message : "Cariler yüklenemedi."); }
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [supplierQuery]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!expense) { void mutation.run(form); return; }
    if (lock.current) return; lock.current = true; setSaving(true); setError("");
    try {
      const changed = Object.fromEntries(Object.entries(form).filter(([key, value]) => key !== "branchId" && value !== initial[key as keyof typeof initial]));
      if (!Object.keys(changed).length) { setError("Değiştirilecek alan yok."); return; }
      const result = await api<{ expense: ExpenseRow }>("/api/expenses/" + expense.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...changed, expectedVersion: expense.version, reason }) }); onSaved(result.expense);
    } catch (error) { setError(error instanceof Error ? error.message : "Gider kaydedilemedi."); }
    finally { lock.current = false; setSaving(false); }
  }
  const needsReason = !!expense && (form.amount !== initial.amount || form.currentAccountId !== initial.currentAccountId);
  return <form onSubmit={submit} className={panel + " space-y-4"}>
    <h2 className="text-lg font-bold">{expense ? "Gideri düzenle" : "Yeni gider"}</h2><Notice error={error || mutation.error || supplierError}/>
    {mutation.pending && <div role="status" className="space-y-2 text-sm"><p>Önceki gider isteğinin sonucu doğrulanmadı. Aynı isteği tekrar doğrulayın.</p><button type="button" className={button} disabled={busy} onClick={() => void mutation.run()}>Bekleyen kaydı doğrula</button></div>}
    <fieldset disabled={blocked} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">Gider başlığı<input required maxLength={200} className={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label>
      <label className="text-sm">Şube<select required disabled={!!expense} className={input} value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })}><option value="">Şube seçin</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-sm">Kategori<select required disabled={paid} className={input} value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}><option value="">Gider kategorisi seçin</option>{categories.filter(c => c.isActive || c.id === expense?.categoryId).map(c => <option key={c.id} value={c.id}>{c.name}{!c.isActive && " (pasif)"}</option>)}</select></label>
      <label className="text-sm">Tutar (TL)<input required disabled={paid} className={input} type="number" min="0.01" step="0.01" max="999999999999.99" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></label>
      <label className="text-sm">Gider tarihi<input required disabled={paid} className={input} type="date" value={form.expenseDate} onChange={e => setForm({ ...form, expenseDate: e.target.value })}/></label>
      <label className="text-sm">Son ödeme tarihi (isteğe bağlı)<input className={input} type="date" min={form.expenseDate} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}/></label>
      <label className="text-sm">Belge / fatura referansı<input className={input} maxLength={100} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}/></label>
      <label className="text-sm">Tedarikçi ara<input className={input} disabled={paid} maxLength={200} placeholder="Cari kodu veya unvan" value={supplierQuery} onChange={e => setSupplierQuery(e.target.value)}/></label>
      <label className="text-sm">İlgili cari (isteğe bağlı)<select disabled={paid} className={input} value={form.currentAccountId} onChange={e => setForm({ ...form, currentAccountId: e.target.value })}><option value="">Cari bağlantısı yok</option>{expense?.currentAccount && !suppliers.some(s => s.id === expense.currentAccountId) && <option value={expense.currentAccount.id}>{expense.currentAccount.name}</option>}{suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Açıklama<textarea className={input} maxLength={1000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
      {expense && <label className="text-sm sm:col-span-2">Düzeltme gerekçesi {needsReason && "(zorunlu)"}<textarea className={input} required={needsReason} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label>}
    </fieldset>
    <p className="text-xs text-muted-foreground">Gider kaydı kasadan para düşürmez. Cari seçilirse tedarikçi borcu oluşturur. Ödemeyi gider detayından kaydedin.{paid && " Ödemeli giderin finansal alanları kilitlidir."}</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={blocked}>{busy ? "Kaydediliyor…" : "Gideri kaydet"}</button><button type="button" className={secondary} disabled={blocked} onClick={onCancel}>Vazgeç</button></div>
  </form>;
}
