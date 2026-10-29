import { Prisma } from "@/generated/prisma/client";
import { CashError } from "@/lib/cash-management";
import { dateInput, objectBody, onlyFields, text } from "@/lib/current-accounts";

const D = Prisma.Decimal;
const round = (n: Prisma.Decimal) => n.toDecimalPlaces(2, D.ROUND_HALF_UP);
export function invoiceDecimal(value: unknown, label: string, scale = 2, positive = false) {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) throw new CashError(`${label} zorunludur.`);
  let n: Prisma.Decimal;
  try { n = new D(value); } catch { throw new CashError(`${label} geçersiz.`); }
  if (!n.isFinite() || n.lt(0) || (positive && n.eq(0)) || n.decimalPlaces() > scale || n.gt("999999999999.99")) throw new CashError(`${label} pozitif/sıfır ve en fazla ${scale} ondalıklı olmalı.`);
  return n;
}
function discount(type: unknown, value: unknown, base: Prisma.Decimal) {
  if (type !== null && type !== undefined && type !== "" && type !== "PERCENT" && type !== "FIXED") throw new CashError("Geçersiz iskonto türü.");
  const discountType: "PERCENT" | "FIXED" | null = type === "PERCENT" || type === "FIXED" ? type : null;
  const discountValue = invoiceDecimal(value ?? "0", "İskonto");
  if ((!discountType && !discountValue.eq(0)) || (discountType === "PERCENT" && discountValue.gt(100))) throw new CashError("İskonto türünü ve değerini kontrol edin.");
  const discountAmount = !discountType ? new D(0) : discountType === "PERCENT" ? round(base.mul(discountValue).div(100)) : discountValue;
  if (discountAmount.gt(base)) throw new CashError("İskonto tutarı tabanı aşamaz.");
  return { discountType, discountValue, discountAmount };
}
export const invoiceFields = ["type", "number", "invoiceDate", "dueDate", "branchId", "currentAccountId", "description", "priceMode", "discountType", "discountValue", "items", "expenseId", "expenseCategoryId"];
export function invoiceInput(body: Record<string, unknown>) {
  if (body.type !== "PURCHASE" && body.type !== "SALES") throw new CashError("Alış/satış türü seçin.");
  if (body.priceMode !== "TAX_EXCLUSIVE" && body.priceMode !== "TAX_INCLUSIVE") throw new CashError("Vergi dahil/hariç fiyatlandırma seçin.");
  const invoiceDate = dateInput(body.invoiceDate), dueDate = dateInput(body.dueDate, true) ?? null;
  if (!invoiceDate || (dueDate && dueDate < invoiceDate)) throw new CashError("Fatura/vade tarihi geçersiz.");
  const number = text(body.number, "fatura numarası", 100, true)!;
  if (/[\x00-\x1f\x7f]/.test(number)) throw new CashError("Fatura numarasında kontrol karakteri olamaz.");
  const numberKey = number.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleUpperCase("tr-TR");
  const expenseId = text(body.expenseId, "gider", 200), expenseCategoryId = text(body.expenseCategoryId, "gider kategorisi", 200);
  if ((expenseId || expenseCategoryId) && body.type !== "PURCHASE") throw new CashError("Gider bağlantısı yalnız alış faturasında kullanılabilir.");
  if (expenseId && expenseCategoryId) throw new CashError("Mevcut gider veya yeni gider kategorisinden birini seçin.");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) throw new CashError("1–200 fatura kalemi girin.");
  const prepared = body.items.map((raw, position) => {
    const item = objectBody(raw);
    onlyFields(item, ["productId", "description", "unit", "quantity", "unitPrice", "discountType", "discountValue", "vatRate"]);
    const quantity = invoiceDecimal(item.quantity, "Miktar", 3, true), unitPrice = invoiceDecimal(item.unitPrice, "Birim fiyat", 4);
    if (quantity.gt("99999999999.999")) throw new CashError("Miktar sınırı aşıldı.");
    const base = round(quantity.mul(unitPrice)), disc = discount(item.discountType, item.discountValue, base);
    const vatRate = invoiceDecimal(item.vatRate, "KDV oranı");
    if (vatRate.gt(100)) throw new CashError("KDV oranı 0–100 arasında olmalı.");
    return { position, productId: text(item.productId, "ürün", 200), description: text(item.description, "kalem açıklaması", 500, true)!, unit: text(item.unit, "birim", 40, true)!, quantity, unitPrice, vatRate, ...disc, base, after: base.minus(disc.discountAmount) };
  });
  const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), new D(0));
  const subtotal = sum(prepared.map(x => x.base)), after = sum(prepared.map(x => x.after));
  const global = discount(body.discountType, body.discountValue, after);
  const shares = prepared.map(item => {
    const exact = after.eq(0) ? new D(0) : global.discountAmount.mul(100).mul(item.after).div(after);
    return { cents: exact.floor(), remainder: exact.minus(exact.floor()), position: item.position };
  });
  const remaining = global.discountAmount.mul(100).minus(sum(shares.map(x => x.cents))).toNumber();
  [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.position - b.position).slice(0, remaining).forEach(x => { x.cents = x.cents.plus(1); });
  const items = prepared.map(preparedItem => {
    const { position, productId, description, unit, quantity, unitPrice, vatRate, discountType, discountValue, discountAmount, after } = preparedItem;
    const item = { position, productId, description, unit, quantity, unitPrice, vatRate, discountType, discountValue, discountAmount };
    const generalDiscountShare = shares[item.position].cents.div(100), discounted = after.minus(generalDiscountShare);
    const netAmount = body.priceMode === "TAX_INCLUSIVE" ? round(discounted.div(new D(1).plus(item.vatRate.div(100)))) : discounted;
    const taxAmount = body.priceMode === "TAX_INCLUSIVE" ? discounted.minus(netAmount) : round(netAmount.mul(item.vatRate).div(100));
    return { ...item, generalDiscountShare, netAmount, taxAmount, total: netAmount.plus(taxAmount) };
  });
  const netTotal = sum(items.map(x => x.netAmount)), taxTotal = sum(items.map(x => x.taxAmount)), grandTotal = netTotal.plus(taxTotal);
  if ([subtotal, grandTotal].some(n => n.gt("999999999999.99"))) throw new CashError("Fatura tutarı sınırı aşıldı.");
  return { type: body.type as "PURCHASE" | "SALES", priceMode: body.priceMode as "TAX_EXCLUSIVE" | "TAX_INCLUSIVE", number, numberKey, invoiceDate, dueDate, currency: "TRY", branchId: text(body.branchId, "şube", 200, true)!, currentAccountId: text(body.currentAccountId, "cari", 200, true)!, description: text(body.description, "açıklama", 2000), expenseId, expenseCategoryId, ...global, subtotal, lineDiscountTotal: sum(items.map(x => x.discountAmount)), netTotal, taxTotal, grandTotal, items };
}
