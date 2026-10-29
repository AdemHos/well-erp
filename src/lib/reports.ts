import { reportTabs, reportPresets, type ReportKey } from "@/lib/report-config";
export { reportTabs, reportPresets, type ReportKey } from "@/lib/report-config";
import { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";
import { dateInput } from "@/lib/current-accounts";
import { hasPermission, type Permission } from "@/lib/permissions";

const requirements: Record<ReportKey, Permission[]> = { overview: ["orders.read"], sales: ["orders.read"], finance: ["finance.manage"], stock: ["stock.manage"], profit: ["orders.read", "finance.manage"], customers: ["customers.read", "orders.read"], suppliers: ["suppliers.read", "finance.manage"], branches: ["staff.read", "orders.read"] };
export const accessibleReports = (role: string) => (Object.keys(reportTabs) as ReportKey[]).filter(key => hasPermission(role, "reports.read") && requirements[key].every(p => hasPermission(role, p)));
export const reportTimezone = "Europe/Istanbul";
const calendarDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: reportTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const shift = (day: string, days: number) => new Date(new Date(day + "T12:00:00Z").getTime() + days * 86400000).toISOString().slice(0, 10);
function midnight(day: string) {
  dateInput(day); // Reject invalid calendar days using the existing validator.
  const desired = new Date(day + "T00:00:00Z").getTime();
  let instant = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: reportTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    if (wall === desired) return new Date(instant);
    instant += desired - wall;
  }
  throw new CashError("Saat diliminde bu günün başlangıcı hesaplanamadı.");
}
export function reportRange(params: URLSearchParams, now = new Date()) {
  const preset = params.get("preset") ?? "last30", today = calendarDay(now);
  let startDay = today, endDay = today;
  if (!Object.hasOwn(reportPresets, preset)) throw new CashError("Geçersiz tarih kısayolu.");
  if (preset === "yesterday") startDay = endDay = shift(today, -1);
  if (preset === "last7") startDay = shift(today, -6);
  if (preset === "last30") startDay = shift(today, -29);
  if (preset === "month") startDay = today.slice(0, 7) + "-01";
  if (preset === "previousMonth") { endDay = shift(today.slice(0, 7) + "-01", -1); startDay = endDay.slice(0, 7) + "-01"; }
  if (preset === "custom") { startDay = params.get("startDate") ?? ""; endDay = params.get("endDate") ?? ""; }
  if (![startDay, endDay].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new CashError("Başlangıç ve bitiş günü seçin.");
  const start = midnight(startDay), inclusiveEnd = midnight(endDay);
  if (start > inclusiveEnd || new Date(endDay).getTime() - new Date(startDay).getTime() > 365 * 86400000) throw new CashError("Tarih aralığı sıralı ve en fazla 366 gün olmalı.");
  return { preset, startDay, endDay, start, end: midnight(shift(endDay, 1)), timezone: reportTimezone };
}
export type ReportRange = ReturnType<typeof reportRange>;
export type Column = { key: string; title: string; kind?: "money" | "number" | "date" | "percent" };
export type ReportRow = Record<string, string | null>;
export type ReportMetric = { key: string; title: string; value: string | null; kind?: Column["kind"]; note?: string };
export type ReportTable = { key: string; title: string; columns: Column[]; rows: ReportRow[]; total: number; page: number; pages: number; note?: string };
export type ReportResult = { key: ReportKey; title: string; range: ReportRange; branchId: string; branchLabel: string; generatedAt: string; tabs: ReportKey[]; branches: { id: string; name: string }[]; metrics: ReportMetric[]; tables: ReportTable[]; warnings: string[]; charts: { key: string; title: string; rows: ReportRow[] }[] };
export const decimal = (value: unknown) => new Prisma.Decimal(String(value ?? "0"));
export const salesRule = "Satış tarihi esaslı, güncel durum raporu: iptaller hariç brüt − indirim − tam iade = net satış. Sonradan yapılan iade, ilk satış dönemini de günceller. Tahsilatlar satışa eklenmez.";
export const costWarning = "Satış anındaki maliyet kaydı bulunmuyor. Güncel ürün maliyeti ve tedarikçi alış fiyatı geçmiş satışın kesin maliyeti olarak kullanılamaz; satış maliyeti, brüt kâr ve marj hesaplanmadı. Güvenilir kârlılık için satış anındaki maliyetin kaydedilmesi gerekir.";
