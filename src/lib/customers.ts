import { CashError } from "@/lib/cash-management";
import { onlyFields, text } from "@/lib/current-accounts";
export const customerTypes = { INDIVIDUAL: "Bireysel", CORPORATE: "Kurumsal" } as const;
export const customerFields = ["type", "code", "name", "phone", "email", "address", "city", "district", "taxOffice", "taxNumber", "notes", "isActive"];
export function customerInput(body: Record<string, unknown>) {
  if (body.type !== "INDIVIDUAL" && body.type !== "CORPORATE") throw new CashError("Geçerli müşteri türü seçin.");
  const code = text(body.code, "müşteri kodu", 40, true)!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) throw new CashError("Müşteri kodunda harf, rakam, nokta, tire, alt çizgi ve / kullanın.");
  const phone = text(body.phone, "telefon", 40), email = text(body.email, "e-posta", 254);
  if (phone && (!/^\+?[\d\s().-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, "")))) throw new CashError("Telefon 7–15 rakam ve geçerli telefon karakterleri içermeli.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CashError("Geçerli e-posta girin.");
  const taxOffice = text(body.taxOffice, "vergi dairesi", 100), taxNumber = text(body.taxNumber, "vergi numarası", 10);
  if (body.type === "INDIVIDUAL" && (taxOffice || taxNumber)) throw new CashError("Vergi alanları yalnız kurumsal müşteriler içindir.");
  if (taxNumber && !/^\d{10}$/.test(taxNumber)) throw new CashError("Vergi numarası 10 rakam olmalı.");
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new CashError("Geçersiz aktiflik değeri.");
  return { type: body.type as keyof typeof customerTypes, code, name: text(body.name, "ad / unvan", 200, true)!, phone, email: email?.toLowerCase() ?? null, address: text(body.address, "adres", 1000), city: text(body.city, "il", 100), district: text(body.district, "ilçe", 100), taxOffice, taxNumber, notes: text(body.notes, "notlar", 2000), isActive: body.isActive === undefined ? true : body.isActive };
}
export function customerVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new CashError("Geçerli müşteri sürümü gereklidir.");
  return value;
}
export function linkInput(body: Record<string, unknown>) {
  const mode = body.accountMode ?? "none";
  if (!["none", "existing", "create"].includes(String(mode))) throw new CashError("Geçersiz cari bağlantı yöntemi.");
  const accountId = text(body.currentAccountId, "cari hesap", 200);
  if ((mode === "existing") !== !!accountId) throw new CashError("Cari bağlantısı için uygun hesap seçin.");
  return { mode: mode as "none" | "existing" | "create", accountId };
}
export function customerCreateFields(body: Record<string, unknown>) {
  onlyFields(body, [...customerFields, "accountMode", "currentAccountId", "idempotencyKey", "expectedOrganizationId"]);
}
