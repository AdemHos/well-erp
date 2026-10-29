import { CashError } from "@/lib/cash-management";
export const productUnits = ["PIECE", "GRAM", "KILOGRAM", "MILLILITER", "LITER"] as const;
export function validateProductBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CashError("Geçerli ürün bilgisi gönderin.");
  const body = value as Record<string, unknown>;
  for (const [key, limit] of Object.entries({ name: 200, description: 2000, sku: 100, barcode: 100, imageUrl: 1000, categoryId: 200 })) {
    if (body[key] != null && (typeof body[key] !== "string" || (body[key] as string).length > limit)) throw new CashError("Geçersiz ürün alanı: " + key);
  }
  for (const key of ["price", "costPrice"]) {
    const amount = body[key];
    if (key === "costPrice" && (amount === undefined || amount === null || amount === "")) continue;
    if ((typeof amount !== "string" && typeof amount !== "number") || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount))) throw new CashError("Fiyat pozitif veya sıfır, en fazla iki ondalıklı olmalıdır.");
  }
  for (const key of ["isActive", "isSellable"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new CashError("Geçersiz ürün durumu.");
  if (body.unit !== undefined && !productUnits.includes(body.unit as typeof productUnits[number])) throw new CashError("Geçersiz ölçü birimi.");
  if (body.imageUrl) { try { if (new URL(String(body.imageUrl)).protocol !== "https:") throw new Error(); } catch { throw new CashError("Görsel için HTTPS adresi kullanın."); } }
}
