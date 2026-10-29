export const defaultBranchSettings = {
  defaultPaymentMethod: "CASH" as "CASH" | "CARD",
  discountRoles: ["OWNER", "ADMIN", "MANAGER", "CASHIER"],
  maxDiscountPercent: 100,
  refundRoles: ["OWNER", "ADMIN", "MANAGER"],
  refundReasonRequired: false,
  customerSelection: "OPTIONAL" as "OPTIONAL" | "HIDDEN" | "REQUIRED",
  allowNegativeStock: false,
  criticalStockEnabled: true,
  defaultCriticalLevel: "0",
  notificationsEnabled: true,
  waiterNotification: true,
  billNotification: true,
  criticalStockNotification: true,
  notificationSound: true,
};
export type BranchSettingsValue = typeof defaultBranchSettings;
export const settingSections = {
  pos: ["defaultPaymentMethod", "discountRoles", "maxDiscountPercent", "refundRoles", "refundReasonRequired", "customerSelection"],
  stock: ["allowNegativeStock", "criticalStockEnabled", "defaultCriticalLevel"],
  notifications: ["notificationsEnabled", "waiterNotification", "billNotification", "criticalStockNotification", "notificationSound"],
} as const;
export type SettingSection = keyof typeof settingSections;
export const businessFields = { name: 160, legalName: 160, businessType: 60, phone: 30, email: 254, website: 500, address: 500, city: 80, district: 80, taxOffice: 120, taxNumber: 11, logoUrl: 500 } as const;
export type BusinessInfo = Record<keyof typeof businessFields, string>;
export const businessLabels: Record<keyof BusinessInfo, string> = { name: "İşletme adı", legalName: "Ticari unvan", businessType: "İşletme türü", phone: "Telefon", email: "E-posta", website: "Web sitesi", address: "Adres", city: "İl", district: "İlçe", taxOffice: "Vergi dairesi", taxNumber: "Vergi numarası (10 hane) / TCKN (11 hane)", logoUrl: "Logo" };
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Geçersiz ayar verisi.");
  return value as Record<string, unknown>;
}
export function parseBusinessInfo(value: unknown): BusinessInfo {
  const body = record(value), result = {} as BusinessInfo;
  if (Object.keys(body).some(k => !Object.hasOwn(businessFields, k))) throw new Error("Beklenmeyen işletme alanı.");
  for (const [key, max] of Object.entries(businessFields)) {
    const v = body[key];
    if (typeof v !== "string" || v.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) throw new Error(`${businessLabels[key as keyof BusinessInfo]} geçersiz.`);
    result[key as keyof BusinessInfo] = v.trim();
  }
  if (!result.name) throw new Error("İşletme adı zorunludur.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("E-posta geçersiz.");
  if (result.phone && (!/^\+?[\d\s().-]{7,30}$/.test(result.phone) || !/^\d{7,15}$/.test(result.phone.replace(/\D/g, "")))) throw new Error("Telefon geçersiz.");
  if (result.taxNumber && !/^(?:\d{10}|[1-9]\d{10})$/.test(result.taxNumber)) throw new Error("Vergi numarası 10, TCKN 11 rakam olmalıdır.");
  for (const key of ["website", "logoUrl"] as const) if (result[key]) {
    let url: URL; try { url = new URL(result[key]); } catch { throw new Error("Geçersiz web/görsel adresi."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Adres HTTPS olmalı ve giriş bilgisi içermemelidir.");
    if (key === "logoUrl" && !(url.hostname.endsWith(".ufs.sh") || url.hostname === "utfs.io")) throw new Error("Logo mevcut yükleme servisi üzerinden yüklenmelidir.");
  }
  return result;
}
export function parseSection(section: SettingSection, value: unknown): Partial<BranchSettingsValue> {
  const body = record(value), keys: readonly string[] = settingSections[section];
  if (Object.keys(body).some(k => !keys.includes(k)) || keys.some(k => !(k in body))) throw new Error("Ayar alanları eksik veya geçersiz.");
  for (const [key, val] of Object.entries(body)) {
    if (key === "discountRoles" || key === "refundRoles") {
      const allowed = key === "refundRoles" ? ["OWNER", "ADMIN", "MANAGER"] : ["OWNER", "ADMIN", "MANAGER", "CASHIER"];
      if (!Array.isArray(val) || val.some(v => typeof v !== "string" || !allowed.includes(v)) || new Set(val).size !== val.length) throw new Error("Rol seçimi geçersiz.");
    } else if (key === "maxDiscountPercent") {
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 100) throw new Error("İndirim sınırı 0–100 arasında tamsayı olmalıdır.");
    } else if (key === "defaultCriticalLevel") {
      if (typeof val !== "string" || !/^\d{1,11}(?:\.\d{1,3})?$/.test(val)) throw new Error("Kritik eşik pozitif veya sıfır, en fazla 3 ondalıklı olmalıdır.");
    } else if (key === "defaultPaymentMethod") {
      if (val !== "CASH" && val !== "CARD") throw new Error("Geçersiz ödeme yöntemi.");
    } else if (key === "customerSelection") {
      if (!["OPTIONAL", "HIDDEN", "REQUIRED"].includes(String(val))) throw new Error("Müşteri seçimi geçersiz.");
    } else if (typeof val !== "boolean") throw new Error("Ayar açık/kapalı olmalıdır.");
  }
  return body as Partial<BranchSettingsValue>;
}
