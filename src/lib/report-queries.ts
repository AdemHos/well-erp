import { Prisma } from "@/generated/prisma/client";
import type { ActiveMembership } from "@/lib/auth-context";
import { allowedBranchIds, hasAllBranches } from "@/lib/permissions";
import type { Column, ReportRange } from "@/lib/reports";

export type Dataset = { key: string; title: string; columns: Column[]; query: Prisma.Sql; note?: string };
const col = (key: string, title: string, kind?: Column["kind"]): Column => ({ key, title, kind });
const amount = col("amount", "Tutar (TRY)", "money"), net = col("net", "Net satış (TRY)", "money"), count = col("count", "Tamamlanan satış", "number"), branch = col("branch", "Şube"), name = col("name", "Ad / unvan"), quantity = col("quantity", "Miktar", "number");
export function reportQueries(actor: ActiveMembership, range: ReportRange, branchId: string, grain: "day" | "week" | "month") {
  const scope = (alias: string) => {
    const a = (field: string) => Prisma.raw(`${alias}."${field}"`);
    const ids = allowedBranchIds(actor);
    return Prisma.sql`${a("organizationId")}=${actor.organizationId} AND ${branchId ? Prisma.sql`${a("branchId")}=${branchId}` : hasAllBranches(actor) ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`${a("branchId")} IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`}`;
  };
  const period = (column: Prisma.Sql) => Prisma.sql`${column}>=${range.start} AND ${column}<${range.end}`;
  // Current full-refund model: the sale cohort is restated by its saved status.
  const sales = Prisma.sql`WITH sales AS (
    SELECT o.*, b.name AS branch, CASE WHEN o.status='COMPLETED' THEN o.total ELSE 0 END AS net,
      CASE WHEN o.status='REFUNDED' THEN o.total ELSE 0 END AS returned
    FROM "Order" o JOIN "Branch" b ON b.id=o."branchId" AND b."organizationId"=o."organizationId"
    WHERE ${scope("o")} AND ${period(Prisma.sql`o."createdAt"`)} AND o.status IN ('COMPLETED','REFUNDED')
  )`;
  // Allocate order discount in cents by largest remainder; sum of line revenues
  // equals saved Order.total exactly, even for tiny discounted multi-line orders.
  const lines = Prisma.sql`${sales}, weights AS (
    SELECT i.*, s.net AS "orderNet", s.total AS "orderTotal", s.status, s.branch, s."branchId", s."customerId",
      s.total*100*i.total/NULLIF(SUM(i.total) OVER(PARTITION BY s.id),0) AS cents
    FROM sales s JOIN "OrderItem" i ON i."orderId"=s.id
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER(PARTITION BY "orderId" ORDER BY (cents-FLOOR(cents)) DESC,id) AS rn,
      "orderTotal"*100-SUM(FLOOR(cents)) OVER(PARTITION BY "orderId") AS remainder FROM weights
  ), lines AS (
    SELECT r.*, CASE WHEN status='COMPLETED' THEN COALESCE((FLOOR(cents)+CASE WHEN rn<=remainder THEN 1 ELSE 0 END)/100,0) ELSE 0 END AS revenue,
      CASE WHEN status='COMPLETED' THEN quantity ELSE 0 END AS sold
    FROM ranked r
  )`;
  const ledger = Prisma.sql`WITH ledger AS (
    SELECT e."currentAccountId",SUM(CASE WHEN e.direction='DEBIT' THEN e.amount ELSE -e.amount END) AS balance
    FROM "CurrentAccountEntry" e WHERE ${scope("e")} GROUP BY e."currentAccountId"
  ), cards AS (
    SELECT a.*,COALESCE(l.balance,0) AS balance FROM "CurrentAccount" a LEFT JOIN ledger l ON l."currentAccountId"=a.id WHERE a."organizationId"=${actor.organizationId}
  )`;
  const invoice = Prisma.sql`WITH allocation AS (
    SELECT a."invoiceId",SUM(a.amount) AS paid FROM "InvoicePaymentAllocation" a
    JOIN "ExpensePayment" p ON p.id=a."paymentId" AND p."organizationId"=a."organizationId" AND p."branchId"=a."branchId"
    WHERE ${scope("a")} AND p."cancelledAt" IS NULL GROUP BY a."invoiceId"
  ), invoices AS (
    SELECT i.*, b.name AS branch, COALESCE(i.snapshot->'account'->>'name',c.name) AS name,
      COALESCE(a.paid,0) AS paid,i."grandTotal"-COALESCE(a.paid,0) AS remaining
    FROM "Invoice" i JOIN "CurrentAccount" c ON c.id=i."currentAccountId" AND c."organizationId"=i."organizationId"
    JOIN "Branch" b ON b.id=i."branchId" AND b."organizationId"=i."organizationId"
    LEFT JOIN allocation a ON a."invoiceId"=i.id WHERE ${scope("i")} AND i.status='ISSUED' AND ${period(Prisma.sql`i."invoiceDate"`)}
  )`;
  const expenses = Prisma.sql`WITH expenses AS (SELECT e.*,c.name AS category FROM "Expense" e JOIN "FinanceCategory" c ON c.id=e."categoryId" AND c."organizationId"=e."organizationId" WHERE ${scope("e")} AND ${period(Prisma.sql`e."expenseDate"`)} AND e."cancelledAt" IS NULL)`;
  const transfer = Prisma.sql`(f.source='MANUAL' AND f.id ~ '^transfer_[a-f0-9]{64}_(in|out)$' AND f.reference='TRANSFER:'||substring(f.id,10,64))`;
  const flow = Prisma.sql`WITH flow AS (SELECT f.*,${transfer} AS transfer FROM "FinanceTransaction" f WHERE ${scope("f")} AND ${period(Prisma.sql`f."occurredAt"`)})`;
  const stock = Prisma.sql`WITH stock AS (
    SELECT s.*,p.name,p.sku,p.unit,CASE WHEN p."isSellable" THEN 'Satılabilir ürün' ELSE 'Hammadde' END AS kind,b.name AS branch
    FROM "BranchStock" s JOIN "Product" p ON p.id=s."productId" AND p."organizationId"=s."organizationId" JOIN "Branch" b ON b.id=s."branchId" AND b."organizationId"=s."organizationId" WHERE ${scope("s")}
  )`;
  const movements = Prisma.sql`WITH movements AS (
    SELECT m.*,p.name,p.unit,p."isSellable", b.name AS branch,
      CASE WHEN m.type IN ('PURCHASE','RETURN','ADJUSTMENT_IN','TRANSFER_IN','PRODUCTION_IN') THEN 'Giriş' ELSE 'Çıkış' END AS direction
    FROM "StockMovement" m JOIN "Product" p ON p.id=m."productId" AND p."organizationId"=m."organizationId" JOIN "Branch" b ON b.id=m."branchId" AND b."organizationId"=m."organizationId"
    WHERE ${scope("m")} AND ${period(Prisma.sql`m."createdAt"`)}
  )`;
  const branchSales = Prisma.sql`${sales} SELECT "branchId" AS id,branch,COUNT(*) FILTER(WHERE status='COMPLETED')::text AS count,SUM(net)::text AS net,SUM(returned)::text AS returned,
    ROUND(COALESCE(SUM(net)/NULLIF(COUNT(*) FILTER(WHERE status='COMPLETED'),0),0),2)::text AS average FROM sales GROUP BY "branchId",branch`;
  const productSales = Prisma.sql`${lines} SELECT COALESCE(l."productId",'deleted')||':'||l."productName" AS id,l."productName" AS name,
    COALESCE(p.unit::text,'Bilinmiyor') AS unit, COALESCE(c.name,'Kategorisiz / silinmiş') AS category,
    SUM(l.sold)::text AS quantity,SUM(l.revenue)::text AS net,NULL::text AS cost,NULL::text AS profit,NULL::text AS margin
    FROM lines l LEFT JOIN "Product" p ON p.id=l."productId" AND p."organizationId"=${actor.organizationId}
    LEFT JOIN "Category" c ON c.id=p."categoryId" AND c."organizationId"=p."organizationId"
    GROUP BY l."productId",l."productName",p.unit,c.name`;
  const datasets = {
    sales: { key: "sales", title: "Satışlar ve tam iadeler", columns: [col("number", "Sipariş"), branch, col("date", "Satış tarihi", "date"), col("status", "Güncel durum"), col("method", "Ödeme yöntemi"), col("gross", "Brüt satış", "money"), col("discount", "İndirim", "money"), col("returned", "İade", "money"), net], query: Prisma.sql`${sales} SELECT id,"orderNumber" AS number,branch,"createdAt" AS date,CASE WHEN status='COMPLETED' THEN 'Tamamlandı' ELSE 'İade' END AS status,CASE WHEN "paymentMethod"='CASH' THEN 'Nakit' ELSE 'Kart' END AS method,subtotal::text AS gross,"discountAmount"::text AS discount,returned::text,net::text FROM sales`, note: "İade, ilk satışın tarihine göre gösterilir; iade günündeki kasa çıkışı nakit akışındadır." },
    products: { key: "products", title: "Ürün bazlı net satış", columns: [name,col("unit","Birim"),quantity,net,col("category","Güncel kategori")], query: productSales },
    branches: { key: "branches", title: "Şube satış karşılaştırması", columns: [branch,count,net,col("returned","İade (TRY)","money"),col("average","Ortalama sepet","money")], query: branchSales },
    methods: { key: "methods", title: "Ödeme yöntemlerine göre satış", columns: [col("name","Ödeme yöntemi"),count,net], query: Prisma.sql`${sales} SELECT "paymentMethod"::text AS id,CASE WHEN "paymentMethod"='CASH' THEN 'Nakit' ELSE 'Kart' END AS name,COUNT(*) FILTER(WHERE status='COMPLETED')::text AS count,SUM(net)::text AS net FROM sales GROUP BY "paymentMethod"` },
    trend: { key: "trend", title: "Satış trendi", columns: [col("name","Dönem başlangıcı"),count,net], query: Prisma.sql`${sales}, buckets AS (SELECT generate_series(date_trunc(${grain},${range.startDay}::date)::timestamp,date_trunc(${grain},${range.endDay}::date)::timestamp,('1 '||${grain})::interval) AS day), totals AS (SELECT date_trunc(${grain},"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul') AS day,COUNT(*) FILTER(WHERE status='COMPLETED') AS count,SUM(net) AS net FROM sales GROUP BY 1) SELECT to_char(b.day,'YYYY-MM-DD') AS id,to_char(b.day,'YYYY-MM-DD') AS name,COALESCE(t.count,0)::text AS count,COALESCE(t.net,0)::text AS net FROM buckets b LEFT JOIN totals t ON t.day=b.day` },
    categories: { key: "categories", title: "Gider kategorileri", columns: [col("name","Gider kategorisi"),amount], query: Prisma.sql`${expenses} SELECT "categoryId" AS id,category AS name,SUM(amount)::text AS amount FROM expenses GROUP BY "categoryId",category` },
    flows: { key: "flows", title: "Nakit akışı / kaynak", columns: [col("name","Kaynak"),col("incoming","Giriş (TRY)","money"),col("outgoing","Çıkış (TRY)","money"),col("net","Net akış (TRY)","money")], query: Prisma.sql`${flow} SELECT CASE WHEN transfer THEN 'TRANSFER' ELSE source::text END AS id,CASE WHEN transfer THEN 'İşletme içi transfer (gelir/gider değil)' ELSE source::text END AS name,COALESCE(SUM(amount) FILTER(WHERE direction='IN'),0)::text AS incoming,COALESCE(SUM(amount) FILTER(WHERE direction='OUT'),0)::text AS outgoing,SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END)::text AS net FROM flow GROUP BY 1,2`, note: "İşlem tarihine göre gerçek kasa hareketleri; iptal ödemelerin asıl ve ters hareketleri kendi tarihlerinde yer alır. Transferler ayrı gösterilir." },
    accounts: { key: "accounts", title: "Hesap bazlı nakit hareketleri", columns: [name,branch,col("opening","Dönem başı bakiye","money"),col("incoming","Giriş (transfer dahil)","money"),col("outgoing","Çıkış (transfer dahil)","money"),col("closing","Dönem sonu bakiye","money")], query: Prisma.sql`SELECT a.id,a.name,b.name AS branch,(a."openingBalance"+COALESCE(SUM(CASE WHEN f."occurredAt"<${range.start} THEN CASE WHEN f.direction='IN' THEN f.amount ELSE -f.amount END ELSE 0 END),0))::text AS opening,COALESCE(SUM(f.amount) FILTER(WHERE f.direction='IN' AND ${period(Prisma.sql`f."occurredAt"`)}),0)::text AS incoming,COALESCE(SUM(f.amount) FILTER(WHERE f.direction='OUT' AND ${period(Prisma.sql`f."occurredAt"`)}),0)::text AS outgoing,(a."openingBalance"+COALESCE(SUM(CASE WHEN f.direction='IN' THEN f.amount ELSE -f.amount END) FILTER(WHERE f."occurredAt"<${range.end}),0))::text AS closing FROM "FinanceAccount" a JOIN "Branch" b ON b.id=a."branchId" AND b."organizationId"=a."organizationId" LEFT JOIN "FinanceTransaction" f ON f."accountId"=a.id AND f."organizationId"=a."organizationId" AND f."branchId"=a."branchId" WHERE ${scope("a")} GROUP BY a.id,a.name,a."openingBalance",b.name` },
    cards: { key: "cards", title: "Güncel açık cari bakiyeler", columns: [col("code","Cari kodu"),name,col("type","Cari türü"),col("receivable","Müşteri alacağı","money"),col("payable","Tedarikçi borcu","money"),col("balance","Net bakiye (borç − alacak)","money")], query: Prisma.sql`${ledger} SELECT id,code,name,type::text,balance::text,CASE WHEN type IN ('CUSTOMER','BOTH') THEN GREATEST(balance,0) ELSE 0 END::text AS receivable,CASE WHEN type IN ('SUPPLIER','BOTH') THEN GREATEST(-balance,0) ELSE 0 END::text AS payable FROM cards WHERE balance<>0`, note: "Anlık bakiye; tarih filtresinden bağımsız, yalnız yetkili/seçili şubeler. Pasif cariler de dahildir." },
    invoices: { key: "invoices", title: "Dönem faturalarının güncel açık tutarları", columns: [col("number","Fatura"),name,branch,col("type","Tür"),col("date","Fatura tarihi","date"),col("due","Vade","date"),col("total","Genel toplam","money"),col("paid","Ödenen","money"),col("remaining","Kalan","money"),col("overdue","Güncel vade durumu")], query: Prisma.sql`${invoice} SELECT id,number,name,branch,CASE WHEN type='PURCHASE' THEN 'Alış' ELSE 'Satış' END AS type,"invoiceDate" AS date,"dueDate" AS due,"grandTotal"::text AS total,paid::text,remaining::text,CASE WHEN "dueDate"<${new Date()} THEN 'Vadesi geçmiş' ELSE 'Açık' END AS overdue FROM invoices WHERE remaining>0`, note: "Tarih filtresi fatura tarihine uygulanır; kalan ve vade durumu rapor anına göredir. Yalnız kesin faturalar; iptal ödemelerin tahsisleri hariç." },
    stock: { key: "stock", title: "Güncel stok", columns: [name,col("sku","Stok kodu"),branch,col("kind","Tür"),col("unit","Birim"),quantity,col("critical","Kritik seviye","number")], query: Prisma.sql`${stock} SELECT id,name,sku,branch,kind,unit::text,quantity::text,"criticalLevel"::text AS critical FROM stock`, note: "Anlık stok; tarih filtresinden bağımsız. Geçmiş tarih stok değerlemesi değildir." },
    critical: { key: "critical", title: "Güncel kritik stoklar", columns: [name,branch,col("unit","Birim"),quantity,col("critical","Kritik seviye","number")], query: Prisma.sql`${stock} SELECT id,name,branch,unit::text,quantity::text,"criticalLevel"::text AS critical FROM stock WHERE quantity<="criticalLevel"` },
    movements: { key: "movements", title: "Dönem stok hareketleri", columns: [col("date","Tarih","date"),name,branch,col("type","Kaynak türü"),col("direction","Yön"),col("unit","Birim"),quantity,col("reference","Referans")], query: Prisma.sql`${movements} SELECT id,"createdAt" AS date,name,branch,type::text,direction,unit::text,quantity::text,reference FROM movements` },
    stockFlows: { key: "stockFlows", title: "Stok giriş / çıkışları", columns: [col("type","Kaynak türü"),col("direction","Yön"),col("unit","Birim"),quantity], query: Prisma.sql`${movements} SELECT type::text||':'||unit::text AS id,type::text,direction,unit::text,SUM(quantity)::text AS quantity FROM movements GROUP BY type,direction,unit`, note: "Birimler birbirine eklenmez. SALE satış tüketimi; RETURN iade; PRODUCTION_OUT reçeteli üretim tüketimidir." },
    ingredients: { key: "ingredients", title: "Hammadde tüketimi", columns: [name,col("unit","Birim"),quantity], query: Prisma.sql`${movements} SELECT "productId" AS id,name,unit::text,SUM(quantity)::text AS quantity FROM movements WHERE NOT "isSellable" AND type='PRODUCTION_OUT' GROUP BY "productId",name,unit` },
    profit: { key: "profit", title: "Ürün satışları / maliyet kapsamı", columns: [name,col("unit","Birim"),quantity,net,col("cost","Satış maliyeti","money"),col("profit","Brüt kâr","money"),col("margin","Brüt marj","percent")], query: productSales },
    categoryProfit: { key: "categoryProfit", title: "Güncel kategoriye göre satış / maliyet kapsamı", columns: [name,net,col("cost","Satış maliyeti","money"),col("profit","Brüt kâr","money")], query: Prisma.sql`SELECT category AS id,category AS name,SUM(net::numeric)::text AS net,NULL::text AS cost,NULL::text AS profit FROM (${productSales}) p GROUP BY category` },
    branchProfit: { key: "branchProfit", title: "Şube satışları / maliyet kapsamı", columns: [branch,net,col("cost","Satış maliyeti","money"),col("profit","Brüt kâr","money")], query: Prisma.sql`SELECT *,NULL::text AS cost,NULL::text AS profit FROM (${branchSales}) b` },
    customers: { key: "customers", title: "Kayıtlı müşteri satışları", columns: [col("code","Müşteri kodu"),name,count,net,col("average","Ortalama sepet","money"),col("last","Dönemde son alışveriş","date")], query: Prisma.sql`${sales} SELECT c.id,c.code,c.name,COUNT(*) FILTER(WHERE s.status='COMPLETED')::text AS count,SUM(s.net)::text AS net,ROUND(COALESCE(SUM(s.net)/NULLIF(COUNT(*) FILTER(WHERE s.status='COMPLETED'),0),0),2)::text AS average,MAX(s."createdAt") FILTER(WHERE s.status='COMPLETED') AS last FROM sales s JOIN "Customer" c ON c.id=s."customerId" AND c."organizationId"=${actor.organizationId} GROUP BY c.id,c.code,c.name`, note: "İsimsiz satışlar hariçtir. İsimler güncel profilden, tutarlar kayıtlı siparişlerden gelir." },
    customerDebt: { key: "customerDebt", title: "Güncel müşteri alacakları", columns: [col("code","Müşteri kodu"),name,col("amount","Açık alacak","money")], query: Prisma.sql`${ledger} SELECT c.id,c.code,c.name,GREATEST(a.balance,0)::text AS amount FROM "Customer" c JOIN cards a ON a.id=c."currentAccountId" WHERE c."organizationId"=${actor.organizationId} AND a.balance>0` },
    suppliers: { key: "suppliers", title: "Tedarikçi bazlı dönem alışları", columns: [col("code","Tedarikçi kodu"),name,col("active","Durum"),col("purchase","Kesin alış faturaları","money"),col("paid","Dönemde yapılan ödeme","money"),col("debt","Güncel açık borç","money"),col("overdue","Dönem faturalarında güncel gecikmiş borç","money")], query: Prisma.sql`${invoice}, ledger AS (SELECT e."currentAccountId",SUM(CASE WHEN e.direction='DEBIT' THEN e.amount ELSE -e.amount END) AS balance FROM "CurrentAccountEntry" e WHERE ${scope("e")} GROUP BY e."currentAccountId"), purchases AS (SELECT "currentAccountId",SUM("grandTotal") AS total,SUM(remaining) FILTER(WHERE "dueDate"<${new Date()}) AS overdue FROM invoices WHERE type='PURCHASE' GROUP BY "currentAccountId"), payments AS (SELECT p."currentAccountId",SUM(p.amount) AS total FROM "ExpensePayment" p WHERE ${scope("p")} AND ${period(Prisma.sql`p."paidAt"`)} AND p."cancelledAt" IS NULL AND p.type IN ('SUPPLIER_PAYMENT','PURCHASE_INVOICE_PAYMENT','EXPENSE_PAYMENT') GROUP BY p."currentAccountId") SELECT s.id,s.code,s.name,CASE WHEN s."isActive" THEN 'Aktif' ELSE 'Pasif' END AS active,COALESCE(i.total,0)::text AS purchase,COALESCE(p.total,0)::text AS paid,GREATEST(-COALESCE(l.balance,0),0)::text AS debt,COALESCE(i.overdue,0)::text AS overdue FROM "Supplier" s LEFT JOIN purchases i ON i."currentAccountId"=s."currentAccountId" LEFT JOIN payments p ON p."currentAccountId"=s."currentAccountId" LEFT JOIN ledger l ON l."currentAccountId"=s."currentAccountId" WHERE s."organizationId"=${actor.organizationId}`, note: "Alış faturası ile ödeme ayrı göstergelerdir. Borç anlıktır. Carisiz tedarikçinin finans geçmişi ilişkilendirilmez; pasifler dahildir." },
  } satisfies Record<string, Dataset>;
  return { datasets, sales, lines, ledger, expenses, flow, invoice, scope, period };
}
