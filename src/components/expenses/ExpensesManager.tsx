"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ExpenseForm from "./ExpenseForm";
import ExpenseCategories from "./ExpenseCategories";
import { api, button, calendarDay, input, money, Notice, Pager, panel, secondary, Stat, statuses, type Branch, type Category, type ExpenseRow } from "./shared";

type Result = { expenses: ExpenseRow[]; summary: { totalAmount: string; paidAmount: string; remainingAmount: string; overdueAmount: string; overdueCount: number }; pagination: { total: number; totalPages: number } };
export default function ExpensesManager() {
  const [data, setData] = useState<Result | null>(null), [branches, setBranches] = useState<Branch[]>([]), [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState({ q: "", categoryId: "", branchId: "", startDate: "", endDate: "", status: "", cancelled: "exclude" });
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [showForm, setShowForm] = useState(false), [showCategories, setShowCategories] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const query = new URLSearchParams({ ...filters, page: String(page) });
        const [result, branchResult, categoryResult] = await Promise.all([
          api<Result>("/api/expenses?" + query, { signal: controller.signal }),
          api<{ branches: Branch[] }>("/api/branches", { signal: controller.signal }),
          api<{ categories: Category[] }>("/api/finance/categories?direction=OUT", { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setData(result); setBranches(branchResult.branches); setCategories(categoryResult.categories); }
      } catch (error) { if (!controller.signal.aborted) { setData(null); setError(error instanceof Error ? error.message : "Giderler yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 180);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [filters, page, revision]);
  const update = (field: keyof typeof filters, value: string) => { setFilters(old => ({ ...old, [field]: value })); setPage(1); };
  return <div className="space-y-5"><Notice error={error} message={message}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat tone="rose" title="Toplam gider" value={money(data?.summary.totalAmount)}/><Stat tone="green" title="Ödenen tutar" value={money(data?.summary.paidAmount)}/><Stat tone="amber" title="Ödenmemiş bakiye" value={money(data?.summary.remainingAmount)}/><Stat tone="amber" title={"Vadesi geçmiş · " + (data?.summary.overdueCount ?? 0) + " gider"} value={money(data?.summary.overdueAmount)}/></div>
    <p className="text-xs text-muted-foreground">Toplamlar seçili filtrelerin tamamını ve yalnızca yetkili şubeleri kapsar. Sayfalama toplamları değiştirmez. İptal edilen giderler finansal toplamlara dahil değildir.</p>
    <div className="flex flex-wrap gap-3"><button className={button} onClick={() => setShowForm(!showForm)}>{showForm ? "Formu kapat" : "+ Yeni gider"}</button><button className={secondary} onClick={() => setShowCategories(!showCategories)}>Kategori yönetimi</button></div>
    {showForm && <ExpenseForm branches={branches} categories={categories} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); setRevision(value => value + 1); setMessage("Gider kaydedildi. Ödemeyi gider detayından yapabilirsiniz."); }}/>}
    {showCategories && <ExpenseCategories categories={categories} onChanged={() => setRevision(value => value + 1)}/>}
    <section className={panel + " space-y-5"}><h2 className="text-lg font-bold">Gider listesi</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <label className="text-sm">Ara<input className={input} maxLength={200} placeholder="Başlık, açıklama, cari veya referans" value={filters.q} onChange={e => update("q", e.target.value)}/></label>
        <label className="text-sm">Kategori<select className={input} value={filters.categoryId} onChange={e => update("categoryId", e.target.value)}><option value="">Tüm gider kategorileri</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{!c.isActive && " (pasif)"}</option>)}</select></label>
        <label className="text-sm">Şube<select className={input} value={filters.branchId} onChange={e => update("branchId", e.target.value)}><option value="">Yetkili tüm şubeler</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="text-sm">Ödeme durumu<select className={input} value={filters.status} onChange={e => update("status", e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm">Başlangıç tarihi<input type="date" className={input} value={filters.startDate} onChange={e => update("startDate", e.target.value)}/></label>
        <label className="text-sm">Bitiş tarihi<input type="date" className={input} value={filters.endDate} onChange={e => update("endDate", e.target.value)}/></label>
        <label className="text-sm">Kayıt durumu<select className={input} value={filters.cancelled} onChange={e => update("cancelled", e.target.value)}><option value="exclude">Geçerli giderler</option><option value="include">İptaller dahil</option><option value="only">Yalnızca iptaller</option></select></label>
      </div>
      {busy && <p role="status" className="text-sm text-muted-foreground">Giderler yükleniyor…</p>}
      <div className="grid gap-4 lg:grid-cols-2" aria-busy={busy}>{data?.expenses.map(expense => <article key={expense.id} className="finance-item min-w-0 rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{expense.branchName} · {expense.categoryName}</p><Link className="mt-1 block break-words text-lg font-bold hover:underline" href={"/dashboard/expenses/" + expense.id}>{expense.title}</Link></div><span className={"shrink-0 rounded-full px-2 py-1 text-xs " + (expense.cancelledAt ? "bg-muted" : expense.paymentStatus === "PAID" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700")}>{expense.cancelledAt ? "İptal" : statuses[expense.paymentStatus]}</span></div><p className="mt-3 text-xl font-bold">{money(expense.amount)}</p><div className="mt-2 grid grid-cols-2 gap-2 text-sm"><p>Ödenen: {money(expense.paidAmount)}</p><p>Kalan: {money(expense.remainingAmount)}</p></div><p className="mt-3 text-xs text-muted-foreground">Tarih: {calendarDay(expense.expenseDate)} · Vade: {calendarDay(expense.dueDate) || "—"}</p>{expense.currentAccountName && <p className="mt-1 break-words text-sm">Cari: {expense.currentAccountName}</p>}<div className="mt-4"><Link className={secondary} href={"/dashboard/expenses/" + expense.id}>Detay / Düzenle / Ödeme</Link></div></article>)}</div>
      {!busy && data?.expenses.length === 0 && <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">Filtrelere uygun gider yok.</p>}
      <Pager page={page} pages={data?.pagination.totalPages ?? 0} busy={busy} onChange={setPage}/>
    </section>
  </div>;
}
