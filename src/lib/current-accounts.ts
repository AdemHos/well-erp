import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";

export const accountTypes = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;
export type AccountType = typeof accountTypes[number];
export const entryKinds = { EXPENSE: "Gider tahakkuku", OPENING: "Açılış", ADJUSTMENT: "Manuel düzeltme", REVERSAL: "Ters kayıt", CREDIT_SALE: "Vadeli satış", CREDIT_PURCHASE: "Vadeli alış", INVOICE: "Fatura", COLLECTION: "Tahsilat", PAYMENT: "Ödeme" };
export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CashError("Geçerli bir JSON nesnesi gönderin.");
  return value as Record<string, unknown>;
}
export function onlyFields(body: Record<string, unknown>, fields: string[]) {
  if (Object.keys(body).some(key => !fields.includes(key))) throw new CashError("Desteklenmeyen alan gönderildi.");
}
export function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new CashError(label + " zorunludur.");
    return null;
  }
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new CashError("Geçersiz " + label + ".");
  return value.trim() || null;
}
export function cardData(body: Record<string, unknown>, partial = false) {
  const fields = ["code", "name", "type", "phone", "email", "address", "taxOffice", "taxNumber", "description", "isActive"];
  onlyFields(body, fields);
  const data: Prisma.CurrentAccountUncheckedUpdateInput = {};
  if (!partial || body.code !== undefined) {
    const code = text(body.code, "cari kodu", 40, true)!.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) throw new CashError("Cari kodunda harf, rakam, nokta, tire, alt çizgi ve / kullanın.");
    data.code = code;
  }
  if (!partial || body.name !== undefined) data.name = text(body.name, "cari adı", 200, true)!;
  if (!partial || body.type !== undefined) {
    if (!accountTypes.includes(body.type as AccountType)) throw new CashError("Geçersiz cari türü.");
    data.type = body.type as AccountType;
  }
  const optional = { phone: 40, email: 254, address: 1000, taxOffice: 100, taxNumber: 11, description: 1000 } as const;
  for (const [key, max] of Object.entries(optional)) {
    if (!partial || body[key] !== undefined) {
      const value = text(body[key], key, max);
      if (key === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new CashError("Geçersiz e-posta.");
      if (key === "taxNumber" && value && !/^\d{10,11}$/.test(value)) throw new CashError("Vergi numarası / TCKN 10 veya 11 rakam olmalıdır.");
      Object.assign(data, { [key]: value });
    }
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new CashError("Geçersiz aktiflik.");
    data.isActive = body.isActive;
  }
  if (partial && !Object.keys(data).length) throw new CashError("Değiştirilecek alan gönderin.");
  return data;
}
export function dateInput(value: unknown, end = false): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new CashError("Geçersiz tarih.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw new CashError("Geçersiz tarih.");
    return new Date(value + (end ? "T23:59:59.999+03:00" : "T00:00:00+03:00"));
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new CashError("Saat dilimi içeren geçerli bir tarih gönderin.");
  dateInput(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw new CashError("Geçersiz saat.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CashError("Geçersiz tarih.");
  return date;
}
export function pagination(params: URLSearchParams) {
  const page = Number(params.get("page") ?? 1), limit = Number(params.get("limit") ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(page * limit)) throw new CashError("Geçersiz sayfalama.");
  return { page, limit, skip: (page - 1) * limit };
}
export function keyInput(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) throw new CashError("Geçerli bir istek anahtarı gereklidir.");
  return value;
}
export function hashRequest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function signedAmount(entry: { direction: string; amount: Prisma.Decimal }) { return entry.direction === "DEBIT" ? entry.amount : entry.amount.negated(); }
export function balanceLabel(value: Prisma.Decimal) { return value.gt(0) ? "RECEIVABLE" : value.lt(0) ? "PAYABLE" : "SETTLED"; }
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
