import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/current-accounts-service";
import { CashError } from "@/lib/cash-management";
import { branchIdScope, hasPermission } from "@/lib/permissions";
import { text } from "@/lib/current-accounts";
import { accessibleReports, costWarning, decimal, reportRange, reportTabs, salesRule, type ReportKey, type ReportMetric, type ReportResult, type ReportRow, type ReportTable } from "@/lib/reports";
import { reportQueries, type Dataset } from "@/lib/report-queries";

export function reportError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("REPORT_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Rapor hazırlanamadı. Daha kısa tarih aralığıyla yeniden deneyin." }, { status: 503 });
}
function normalize(row: Record<string, unknown>): ReportRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? null : value instanceof Date ? value.toISOString() : String(value)]));
}
export async function loadReport(request: NextRequest, exporting = false): Promise<ReportResult> {
  const actor = await currentActor(), params = request.nextUrl.searchParams;
  const tabs = accessibleReports(actor.role), key = (params.get("report") ?? tabs[0] ?? "overview") as ReportKey;
  if (!tabs.includes(key)) throw new CashError("Bu rapor için yetkiniz yok.", 403);
  if (params.has("organizationId")) throw new CashError("İşletme kapsamı oturumdan belirlenir; organizationId göndermeyin.");
  const range = reportRange(params), branchId = text(params.get("branchId"), "şube", 200) ?? "";
  const page = Number(params.get("page") ?? 1), grain = params.get("grain") ?? "day";
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !["day", "week", "month"].includes(grain)) throw new CashError("Geçersiz sayfa veya trend aralığı.");
  const canFinance = hasPermission(actor.role, "finance.manage");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000'`;
    const branches = await tx.branch.findMany({ where: { organizationId: actor.organizationId, ...branchIdScope(actor) }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    if (branchId && !branches.some(b => b.id === branchId)) throw new CashError("Şube bulunamadı veya erişim yetkiniz yok.", 404);
    const q = reportQueries(actor, range, branchId, grain as "day" | "week" | "month");
    const warnings: string[] = [], metrics: ReportMetric[] = [], tables: ReportTable[] = [], charts: ReportResult["charts"] = [];
    const metric = (key: string, title: string, value: unknown, kind: ReportMetric["kind"] = "money", note?: string) => metrics.push({ key, title, value: value == null ? null : String(value), kind, note });
    let exportRows = 0;
    async function rows(query: Prisma.Sql) { return (await tx.$queryRaw<Record<string, unknown>[]>(query)).map(normalize); }
    async function table(d: Dataset, sort: Prisma.Sql = Prisma.sql`id ASC`) {
      const [count] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS count FROM (${d.query}) r`);
      const total = Number(count.count);
      if (exporting && exportRows + total > 10000) throw new CashError("Dışa aktarım en fazla 10.000 detay satırı içerir. Tarihi veya şube kapsamını daraltın.", 422);
      const data = await rows(Prisma.sql`SELECT * FROM (${d.query}) r ORDER BY ${sort} LIMIT ${exporting ? 10000 : 20} OFFSET ${exporting ? 0 : (page - 1) * 20}`);
      exportRows += data.length;
      tables.push({ key: d.key, title: d.title, columns: d.columns, rows: data, total, page: exporting ? 1 : page, pages: Math.ceil(total / 20), note: d.note });
    }
    if (["overview", "sales", "finance", "profit", "branches"].includes(key)) {
      const [s] = await rows(Prisma.sql`${q.sales} SELECT COALESCE(SUM(subtotal),0)::text AS gross,COALESCE(SUM("discountAmount"),0)::text AS discount,COALESCE(SUM(returned),0)::text AS returned,COALESCE(SUM(net),0)::text AS net,COUNT(*) FILTER(WHERE status='COMPLETED')::text AS count,COALESCE(SUM(net)/NULLIF(COUNT(*) FILTER(WHERE status='COMPLETED'),0),0)::text AS average,COALESCE(SUM(net) FILTER(WHERE "paymentMethod"='CASH'),0)::text AS cash,COALESCE(SUM(net) FILTER(WHERE "paymentMethod"='CARD'),0)::text AS card FROM sales`);
      metric("netSales", "Net POS satış", s.net); metric("completedCount", "Tamamlanan satış", s.count, "number"); metric("average", "Ortalama sepet", decimal(s.average).toDecimalPlaces(2).toString()); metric("returned", "İlk satış tarihine göre tam iade", s.returned);
      if (key === "sales") { metric("gross", "Brüt satış (iptaller hariç)", s.gross); metric("discount", "İndirim toplamı", s.discount); metric("cash", "Nakit net satış", s.cash); metric("card", "Kart net satış", s.card); }
      warnings.push(salesRule);
      const [missing] = await rows(Prisma.sql`${q.sales} SELECT COUNT(*)::text AS count FROM sales s WHERE status='COMPLETED' AND total>0 AND NOT EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId"=s.id AND i.total>0)`);
      if (decimal(missing.count).gt(0)) warnings.push(missing.count + " tamamlanmış satışta dağıtılabilir satır tutarı bulunmuyor; sipariş toplamı KPI'ya dahildir, ürün/kategori geliri bu kayıtlar için hesaplanamaz.");
      if ((key === "overview" || key === "finance") && canFinance) {
        const [e] = await rows(Prisma.sql`${q.expenses} SELECT COALESCE(SUM(amount),0)::text AS total FROM expenses`);
        metric("expenses", "Dönem giderleri (tahakkuk)", e.total, "money", "Gider tarihi; iptaller hariç. Ödemeler tekrar gider sayılmaz.");
        metric("grossProfit", "Brüt kâr", null, "money", "Satış anındaki maliyet kaydı bulunmuyor.");
        const [l] = await rows(Prisma.sql`${q.ledger} SELECT COALESCE(SUM(GREATEST(balance,0)) FILTER(WHERE type IN ('CUSTOMER','BOTH')),0)::text AS receivable,COALESCE(SUM(GREATEST(-balance,0)) FILTER(WHERE type IN ('SUPPLIER','BOTH')),0)::text AS payable FROM cards`);
        metric("receivable", "Anlık müşteri alacakları", l.receivable, "money", "Tarih filtresinden bağımsız; seçili/yetkili şubeler."); metric("payable", "Anlık tedarikçi borçları", l.payable, "money", "Tarih filtresinden bağımsız; pasif cariler dahil.");
        if (key === "finance") metric("managementDifference", "Yönetimsel POS satış − kayıtlı gider", decimal(s.net).minus(decimal(e.total)).toString(), "money", "Satış maliyeti, tüm vergi ve muhasebe düzeltmeleri yok; net kâr değildir. Satış faturaları POS'a eklenmez.");
      }
    }
    if (key === "overview") {
      charts.push({ key: "trend", title: "Satış trendi", rows: await rows(Prisma.sql`SELECT * FROM (${q.datasets.trend.query}) r ORDER BY id`) }, { key: "methods", title: "Ödeme yöntemleri (net satış)", rows: await rows(q.datasets.methods.query) }, { key: "topProducts", title: "Net gelire göre ilk 5 ürün", rows: await rows(Prisma.sql`SELECT * FROM (${q.datasets.products.query}) r ORDER BY net::numeric DESC,id LIMIT 5`) }, { key: "branches", title: "Net satışa göre ilk 20 şube", rows: await rows(Prisma.sql`SELECT *,branch AS name FROM (${q.datasets.branches.query}) r ORDER BY net::numeric DESC,id LIMIT 20`) });
      // Charts have the same source queries in exports; no client-side reconstruction.
      for (const d of [q.datasets.trend, q.datasets.methods, q.datasets.products, q.datasets.branches]) await table(d, d.key === "trend" ? Prisma.sql`id` : Prisma.sql`net::numeric DESC,id`);
      if (canFinance) warnings.push(costWarning);
    }
    if (key === "sales") { await table(q.datasets.sales); await table(q.datasets.products, Prisma.sql`quantity::numeric DESC,id`); await table(q.datasets.methods); await table(q.datasets.branches, Prisma.sql`net::numeric DESC,id`); }
    if (key === "finance") {
      const [f] = await rows(Prisma.sql`${q.flow} SELECT COALESCE(SUM(amount) FILTER(WHERE direction='IN' AND NOT transfer),0)::text AS incoming,COALESCE(SUM(amount) FILTER(WHERE direction='OUT' AND NOT transfer),0)::text AS outgoing,COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END) FILTER(WHERE NOT transfer),0)::text AS net FROM flow`);
      metric("incoming", "Transfer hariç nakit girişleri", f.incoming); metric("outgoing", "Transfer hariç nakit çıkışları", f.outgoing); metric("cashFlow", "Transfer hariç net nakit akışı", f.net);
      const [i] = await rows(Prisma.sql`${q.invoice} SELECT COALESCE(SUM(remaining) FILTER(WHERE type='SALES'),0)::text AS receivable,COALESCE(SUM(remaining) FILTER(WHERE type='PURCHASE'),0)::text AS payable,COALESCE(SUM(remaining) FILTER(WHERE type='SALES' AND "dueDate"<${new Date()}),0)::text AS "overdueReceivable",COALESCE(SUM(remaining) FILTER(WHERE type='PURCHASE' AND "dueDate"<${new Date()}),0)::text AS "overduePayable" FROM invoices WHERE remaining>0`);
      metric("invoiceReceivable", "Dönem faturaları: güncel alacak", i.receivable); metric("invoicePayable", "Dönem faturaları: güncel borç", i.payable); metric("overdueReceivable", "Dönem faturaları: vadesi geçmiş alacak", i.overdueReceivable); metric("overduePayable", "Dönem faturaları: vadesi geçmiş borç", i.overduePayable);
      for (const d of [q.datasets.accounts, q.datasets.flows, q.datasets.categories, q.datasets.cards, q.datasets.invoices]) await table(d);
      warnings.push("Yönetimsel Gelir-Gider Özeti: POS satışları ve kayıtlı giderlerdir; tam muhasebe kâr-zarar tablosu değildir. Satış faturası ve tahsilat tekrar satış sayılmaz. Nakit akışı, gerçekleşen kasa hareketlerini asıl/ters işlem tarihlerinde gösterir; aynı dönem dışındaki iptaller geçmiş nakit akışını silmez.");
    }
    if (key === "stock") {
      const [s] = await rows(Prisma.sql`SELECT COUNT(*)::text AS count,COUNT(*) FILTER(WHERE quantity<="criticalLevel")::text AS critical FROM "BranchStock" s WHERE ${q.scope("s")}`);
      metric("stockCount", "Güncel stok satırı", s.count, "number"); metric("criticalCount", "Güncel kritik stok satırı", s.critical, "number");
      for (const d of [q.datasets.stock, q.datasets.critical, q.datasets.stockFlows, q.datasets.ingredients, q.datasets.movements]) await table(d, d.key === "ingredients" ? Prisma.sql`quantity::numeric DESC,id` : Prisma.sql`id`);
      warnings.push("Stok miktarları anlık, hareketler seçili döneme aittir. Birim ve hammadde sınıflandırması ürünün güncel kaydına göredir. Birim farkları nedeniyle miktarlar tek bir genel toplamda birleştirilmez. Geçmiş maliyet yöntemi yok; kesin stok değerlemesi sunulmaz. Reçeteli tüketim kayıtlı üretim çıkışlarından okunur; POS hareketlerinden varsayımsal tüketim çıkarılmaz.");
    }
    if (key === "profit") { metric("cost", "Satış maliyeti", null); metric("profit", "Brüt kâr", null); metric("margin", "Brüt kâr marjı", null, "percent"); for (const d of [q.datasets.profit, q.datasets.categoryProfit, q.datasets.branchProfit]) await table(d, Prisma.sql`net::numeric DESC,id`); warnings.push(costWarning, "Kategori, ürünün güncel sınıflandırmasıdır; geçmiş kategori snapshot'ı değildir. Gelirler sipariş iskontosu kuruş bazında dağıtılarak hesaplanır."); }
    if (key === "customers") {
      const total = await tx.customer.count({ where: { organizationId: actor.organizationId } });
      const [c] = await rows(Prisma.sql`${q.sales} SELECT COUNT(DISTINCT "customerId") FILTER(WHERE status='COMPLETED')::text AS active FROM sales WHERE "customerId" IS NOT NULL`);
      metric("totalCustomers", "Güncel kayıtlı müşteri (işletme)", total, "number"); metric("activeCustomers", "Dönemde alışveriş yapan müşteri", c.active, "number");
      await table(q.datasets.customers, Prisma.sql`net::numeric DESC,id`); if (canFinance) await table(q.datasets.customerDebt, Prisma.sql`amount::numeric DESC,id`);
      warnings.push(salesRule, "Toplam müşteri işletmenin ortak havuzudur; alışveriş ve cari tutarlar yalnız seçili/yetkili şubelerden gelir. İsimsiz POS satışları bu tabloda yoktur.");
    }
    if (key === "suppliers") {
      const total = await tx.supplier.count({ where: { organizationId: actor.organizationId } }), active = await tx.supplier.count({ where: { organizationId: actor.organizationId, isActive: true } });
      metric("supplierCount", "Güncel tedarikçi sayısı (işletme)", total, "number"); metric("activeSuppliers", "Aktif tedarikçi (işletme)", active, "number");
      const [s] = await rows(Prisma.sql`SELECT COALESCE(SUM(purchase::numeric),0)::text AS purchase,COALESCE(SUM(paid::numeric),0)::text AS paid,COALESCE(SUM(debt::numeric),0)::text AS debt,COALESCE(SUM(overdue::numeric),0)::text AS overdue FROM (${q.datasets.suppliers.query}) r`);
      metric("purchase", "Dönem alış faturaları (bağlı profiller)", s.purchase); metric("paid", "Dönemde yapılan ödemeler", s.paid); metric("debt", "Anlık tedarikçi borcu", s.debt); metric("overdue", "Dönem faturalarında gecikmiş borç", s.overdue);
      await table(q.datasets.suppliers, Prisma.sql`purchase::numeric DESC,id`); warnings.push("Fatura tarihi ve ödeme tarihi ayrı filtrelenir. İptal belgeler ve iptal ödemeler toplamlarda yoktur. Açık borç tarih filtresinden bağımsız anlıktır. Ortak tedarikçi havuzu, yalnız yetkili şubelerin finans verileriyle gösterilir.");
    }
    if (key === "branches") {
      await table(q.datasets.branches, Prisma.sql`net::numeric DESC,id`);
      const calendarStart = new Date(range.startDay + "T12:00:00Z").getTime();
      const days = Math.round((new Date(range.endDay).getTime() - new Date(range.startDay).getTime()) / 86400000) + 1;
      const previousRange = reportRange(new URLSearchParams({ preset: "custom", startDate: new Date(calendarStart - days * 86400000).toISOString().slice(0,10), endDate: new Date(calendarStart - 86400000).toISOString().slice(0,10) }));
      const previous = reportQueries(actor, previousRange, branchId, "day").datasets.branches;
      await table({ key: "comparison", title: "Önceki eşit uzunluktaki dönemle şube karşılaştırması", columns: [{ key: "branch", title: "Şube" }, { key: "net", title: "Seçili dönem net satış", kind: "money" }, { key: "previous", title: "Önceki dönem net satış", kind: "money" }], query: Prisma.sql`SELECT COALESCE(a.id,b.id) AS id,COALESCE(a.branch,b.branch) AS branch,COALESCE(a.net,'0') AS net,COALESCE(b.net,'0') AS previous FROM (${q.datasets.branches.query}) a FULL JOIN (${previous.query}) b ON b.id=a.id`, note: `${previousRange.start.toISOString()} (dahil) – ${previousRange.end.toISOString()} (hariç). Tarih filtresi seçili dönem içindir; önceki dönem yalnız açık karşılaştırmadır.` });
      warnings.push("Siparişte güvenilir satış yapan personel/satış personeli snapshot'ı bulunmuyor. Faturayı düzenleyen, iadeyi yapan veya güncel şube personeli satış yapan kişi sayılmaz. Personel satış sıralaması üretilmedi.");
    }
    return { key, title: reportTabs[key], range, branchId, branchLabel: branchId ? branches.find(b => b.id === branchId)!.name : "Yetkili tüm şubeler", generatedAt: new Date().toISOString(), tabs, branches, metrics, tables, charts, warnings };
  }, { isolationLevel: "RepeatableRead", timeout: 30000, maxWait: 3000 });
}
export async function getReport(request: NextRequest) {
  try { return NextResponse.json(await loadReport(request), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return reportError(error); }
}
