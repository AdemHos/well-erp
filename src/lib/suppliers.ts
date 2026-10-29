import { CashError } from "@/lib/cash-management";
import { onlyFields, text } from "@/lib/current-accounts";
export const supplierFields = ["contactName", "website", "code", "name", "phone", "email", "address", "city", "district", "taxOffice", "taxNumber", "notes", "isActive"];
export function supplierInput(body: Record<string, unknown>) {
  const code = text(body.code, "tedarikçi kodu", 40, true)!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) throw new CashError("Tedarikçi kodunda harf, rakam, nokta, tire, alt çizgi ve / kullanın.");
  const phone = text(body.phone, "telefon", 40), email = text(body.email, "e-posta", 254);
  if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, "")))) throw new CashError("Telefon 7–15 rakam ve geçerli telefon karakterleri içermeli.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CashError("Geçerli e-posta girin.");
  const taxOffice = text(body.taxOffice, "vergi dairesi", 100), taxNumber = text(body.taxNumber, "vergi numarası", 11);
  if (taxNumber && !/^\d{10,11}$/.test(taxNumber)) throw new CashError("Vergi numarası 10 veya 11 rakam olmalı.");
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new CashError("Geçersiz aktiflik değeri.");
  const website = text(body.website, "web sitesi", 500);
  if (website) { try { const url = new URL(website); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error(); } catch { throw new CashError("http/https ile başlayan geçerli web sitesi girin."); } }
  return { contactName: text(body.contactName, "yetkili kişi", 200), website, code, name: text(body.name, "ad / unvan", 200, true)!, phone, email: email?.toLowerCase() ?? null, address: text(body.address, "adres", 1000), city: text(body.city, "il", 100), district: text(body.district, "ilçe", 100), taxOffice, taxNumber, notes: text(body.notes, "notlar", 2000), isActive: body.isActive === undefined ? true : body.isActive };
}
export function supplierVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new CashError("Geçerli tedarikçi sürümü gereklidir.");
  return value;
}
export function linkInput(body: Record<string, unknown>) {
  const mode = body.accountMode ?? "none";
  if (!["none", "existing", "create"].includes(String(mode))) throw new CashError("Geçersiz cari bağlantı yöntemi.");
  const accountId = text(body.currentAccountId, "cari hesap", 200);
  if ((mode === "existing") !== !!accountId) throw new CashError("Cari bağlantısı için uygun hesap seçin.");
  return { mode: mode as "none" | "existing" | "create", accountId };
}
export function supplierCreateFields(body: Record<string, unknown>) {
  onlyFields(body, [...supplierFields, "accountMode", "currentAccountId", "idempotencyKey", "expectedOrganizationId"]);
}
