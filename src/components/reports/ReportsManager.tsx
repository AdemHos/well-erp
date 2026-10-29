"use client";
import { useEffect, useState } from "react";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, button, secondary, input, panel, money, date, Notice, Stat, Pager } from "@/components/current-accounts/shared";
import { reportTabs, reportPresets, reportCellLabel, type ReportKey } from "@/lib/report-config";
import type { Column, ReportResult, ReportRow } from "@/lib/reports";

function cell(value: string | null, kind?: Column["kind"]) {
  if (value == null) return kind === "money" || kind === "percent" ? "Hesaplanamadı" : "—";
  if (kind === "money") return money(value);
  if (kind === "date") return date(value);
  if (kind === "number") return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value));
  if (kind === "percent") return value + "%";
  return value;
}
function Chart({ title, rows, trend }: { title: string; rows: ReportRow[]; trend: boolean }) {
  // Numbers are only used to draw charts. All financial calculations are SQL numeric/Decimal.
  const values = rows.map(r => ({ name: r.name ?? r.branch ?? "—", net: Number(r.net ?? 0) }));
  return <section className={panel + " min-w-0"}><h2 className="mb-4 font-semibold">{title}</h2>{values.length ? <div className="h-64" role="img" aria-label={title}><ResponsiveContainer width="100%" height="100%">{trend ? <AreaChart data={values}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{ fontSize: 11 }}/><YAxis tick={{ fontSize: 11 }} width={65}/><Tooltip formatter={value => money(String(value))}/><Area type="monotone" dataKey="net" name="Net satış" stroke="#2563eb" fill="#dbeafe"/></AreaChart> : <BarChart data={values}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0}/><YAxis width={65} tick={{ fontSize: 11 }}/><Tooltip formatter={value => money(String(value))}/><Bar dataKey="net" name="Net satış" fill="#3b82f6" radius={[5,5,0,0]}/></BarChart>}</ResponsiveContainer></div> : <p className="rounded-xl bg-blue-50/60 p-8 text-center text-sm text-slate-500">Bu kapsamda satış kaydı yok.</p>}</section>;
}
export default function ReportsManager() {
  const [filters, setFilters] = useState({ report: "overview" as ReportKey, preset: "last30", startDate: "", endDate: "", branchId: "", grain: "day" });
  const [data, setData] = useState<ReportResult | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(""), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [loadedSignature, setSignature] = useState("");
  const signature = new URLSearchParams(filters).toString();
  const ready = filters.preset !== "custom" || !!filters.startDate && !!filters.endDate;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const result = await api<ReportResult>("/api/reports?" + signature + "&page=" + page, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result); setSignature(signature); }
      } catch (e) { if (!controller.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "Rapor yüklenemedi."); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [signature, ready, page, revision]);
  const stale = !ready || signature !== loadedSignature;
  function filter(key: keyof typeof filters, value: string) { setFilters(f => ({ ...f, [key]: value })); setPage(1); }
  const visibleData = stale ? null : data;
  const maxPages = Math.max(1, ...data?.tables.map(t => t.pages) ?? [1]);
  // Let the browser download the real HTTP attachment, preserving its server filename
  // and MIME type. A separate tab also keeps API errors from replacing this report.
  return <div className="space-y-5"><Notice error={error}/>
    <div role="tablist" aria-label="Rapor bölümleri" className="flex gap-2 overflow-x-auto pb-2">{(data?.tabs ?? Object.keys(reportTabs) as ReportKey[]).map(key => <button key={key} role="tab" aria-selected={filters.report === key} aria-controls="report-content" className={(filters.report === key ? button : secondary) + " shrink-0"} onClick={() => filter("report", key)}>{reportTabs[key]}</button>)}</div>
    <section className={panel + " grid gap-3 sm:grid-cols-2 xl:grid-cols-4"} aria-label="Rapor filtreleri"><label className="text-sm">Tarih aralığı<select className={input} value={filters.preset} onChange={e => filter("preset", e.target.value)}>{Object.entries(reportPresets).map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label><label className="text-sm">Şube<select className={input} value={filters.branchId} onChange={e => filter("branchId", e.target.value)}><option value="">Yetkili tüm şubeler</option>{data?.branches.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
    {filters.preset === "custom" && <><label className="text-sm">Başlangıç<input className={input} type="date" value={filters.startDate} onChange={e => filter("startDate", e.target.value)}/></label><label className="text-sm">Bitiş (dahil)<input className={input} type="date" value={filters.endDate} onChange={e => filter("endDate", e.target.value)}/></label></>}
    {filters.report === "overview" && <label className="text-sm">Satış trendi<select className={input} value={filters.grain} onChange={e => filter("grain", e.target.value)}><option value="day">Günlük</option><option value="week">Haftalık</option><option value="month">Aylık</option></select></label>}
    <div className="flex flex-wrap items-end gap-2"><button className={secondary} disabled={busy || !ready} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/>Yenile</button>{(["csv", "xlsx"] as const).map(format => busy || stale || !data ? <button key={format} className={secondary} disabled><Download size={16}/>{format === "xlsx" ? "Excel" : "CSV"}</button> : <a key={format} className={secondary} href={"/api/reports/export?" + signature + "&format=" + format} target="_blank" rel="noopener noreferrer"><Download size={16}/>{format === "xlsx" ? "Excel" : "CSV"}</a>)}</div></section>
    {!ready && <p className="text-sm text-slate-500">Başlangıç ve bitiş günlerini seçin. En fazla 366 günlük aralık kullanılabilir.</p>}
    {busy && ready && <p role="status" className="text-sm text-blue-600">Rapor hazırlanıyor…</p>}
    {visibleData && <div id="report-content" role="tabpanel" className="space-y-5"><section className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900"><p className="font-semibold">{visibleData.title} · {visibleData.range.startDay} – {visibleData.range.endDay} (başlangıç ve bitiş dahil)</p><p className="mt-1">{visibleData.branchLabel} · {visibleData.range.timezone} · Rapor zamanı: {date(visibleData.generatedAt)}</p><p className="mt-1 text-xs">Anlık olarak etiketlenen bakiyeler ve stoklar tarih filtresinden bağımsızdır. Dışa aktarım, aynı filtrelerle raporu yeniden hesaplar; arada yeni işlem varsa tutarlar değişebilir. En fazla 10.000 detay satırı.</p></section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{visibleData.metrics.map(m => <Stat key={m.key} tone={m.value === null ? "amber" : "blue"} title={m.title} value={cell(m.value, m.kind)} description={m.note}/>)}</div>
      {visibleData.warnings.length > 0 && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{visibleData.warnings.map(w => <p key={w}>{w}</p>)}</div>}
      {visibleData.charts.length > 0 && <div className="grid gap-4 xl:grid-cols-2">{visibleData.charts.map(c => <Chart key={c.key} title={c.title} rows={c.rows} trend={c.key === "trend"}/>)}</div>}
      {visibleData.tables.map(table => <section className={panel + " min-w-0 space-y-3"} key={table.key}><div className="flex items-center gap-2"><BarChart3 className="text-blue-500" size={18}/><h2 className="font-semibold">{table.title}</h2><span className="text-xs text-slate-500">{table.total} satır</span></div>{table.note && <p className="text-xs leading-5 text-slate-500">{table.note}</p>}<div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead><tr>{table.columns.map(c => <th className="whitespace-nowrap p-3 text-xs text-slate-500" key={c.key}>{c.title}</th>)}</tr></thead><tbody>{table.rows.map((r, i) => <tr className="border-t border-slate-100" key={r.id ?? i}>{table.columns.map(c => <td className={"max-w-72 break-words p-3 " + (c.kind ? "tabular-nums" : "")} key={c.key}>{cell(reportCellLabel(r[c.key], c.key, table.key), c.kind)}</td>)}</tr>)}</tbody></table></div>{!table.rows.length && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Bu sayfa ve filtrelerde kayıt yok.{table.total > 0 ? " Önceki sayfalara geçebilirsiniz." : ""}</p>}</section>)}
      <p className="text-xs text-slate-500">Sayfalama tüm detay tablolarını birlikte değiştirir; her tabloda en fazla 20 satır. Grafikler ve göstergeler sayfalama öncesi kapsamı gösterir.</p><Pager page={page} pages={maxPages} busy={busy} onChange={setPage}/>
    </div>}
  </div>;
}
