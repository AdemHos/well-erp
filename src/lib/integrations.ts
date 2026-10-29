export type IntegrationSupport = "AVAILABLE" | "COMING_SOON";
export type IntegrationConnection = "CONNECTED" | "DISCONNECTED" | "ERROR";
export const integrationCategories = ["Donanım", "Ödeme Sistemleri", "e-Belge", "Sipariş Platformları", "Geliştirici Araçları"] as const;
type Integration = { id: string; name: string; description: string; category: typeof integrationCategories[number]; support: IntegrationSupport; connection: IntegrationConnection; connectionNote: string };
export const integrationCatalog: readonly Integration[] = [
  { id: "printer", name: "Termal yazıcı", description: "Mevcut 58 / 80 mm satış fişini tarayıcı üzerinden yazdırın.", category: "Donanım", support: "AVAILABLE", connection: "DISCONNECTED", connectionNote: "Tarayıcı yazdırması; fiziksel cihaz bağlantısı izlenmez." },
  { id: "barcode", name: "Barkod okuyucu", description: "Klavye gibi çalışan USB / Bluetooth okuyucuyla POS arama alanına okutun ve Enter gönderin. Tekrar okutma miktarı artırır.", category: "Donanım", support: "AVAILABLE", connection: "DISCONNECTED", connectionNote: "Klavye girişi desteklenir; cihaz bağlantısı izlenmez." },
  { id: "scale", name: "Terazi", description: "Stok ve satış modeli ondalıklı miktar destekler. POS'ta manuel ağırlık girişi ve terazi barkodu ayrıştırması henüz yok. Gerçek bağlantı için cihaz protokolü gerekli.", category: "Donanım", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Terazi bağlantısı uygulanmadı." },
  { id: "terminal", name: "Fiziksel ödeme terminalleri", description: "Mevcut nakit / kart satış kaydı banka veya ödeme terminali bağlantısı kurmaz.", category: "Ödeme Sistemleri", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Terminal bağlantısı uygulanmadı." },
  { id: "einvoice", name: "e-Fatura / e-Arşiv", description: "Mevcut satış fişi mali belge değildir. e-Belge sağlayıcı bağlantıları sonraki aşamada geliştirilecek.", category: "e-Belge", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Sağlayıcı bağlantısı uygulanmadı." },
  { id: "trendyol", name: "Trendyol Yemek", description: "Sipariş aktarımı sonraki aşamada geliştirilecek.", category: "Sipariş Platformları", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Platform bağlantısı uygulanmadı." },
  { id: "yemeksepeti", name: "Yemeksepeti", description: "Sipariş aktarımı sonraki aşamada geliştirilecek.", category: "Sipariş Platformları", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Platform bağlantısı uygulanmadı." },
  { id: "api", name: "Harici API / Webhook", description: "Harici API erişimi ve webhook teslimatı sonraki aşamada geliştirilecek. API anahtarı toplanmaz.", category: "Geliştirici Araçları", support: "COMING_SOON", connection: "DISCONNECTED", connectionNote: "Harici bağlantı uygulanmadı." },
];
export type PrinterSettings = { paperWidth: "58" | "80"; receiptHeader: string; receiptFooter: string; afterSalePrint: "MANUAL" | "OPEN_DIALOG"; showOrganization: boolean; showBranch: boolean };
export const defaultPrinterSettings: PrinterSettings = { paperWidth: "80", receiptHeader: "", receiptFooter: "Teşekkür ederiz. Yine bekleriz!", afterSalePrint: "MANUAL", showOrganization: true, showBranch: true };

export function parsePrinterSettings(value: unknown): PrinterSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Geçersiz yazıcı ayarları.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !Object.hasOwn(defaultPrinterSettings, key)) ||
    !["58", "80"].includes(String(body.paperWidth)) || typeof body.paperWidth !== "string" ||
    !["MANUAL", "OPEN_DIALOG"].includes(String(body.afterSalePrint)) ||
    typeof body.receiptHeader !== "string" || body.receiptHeader.length > 160 ||
    typeof body.receiptFooter !== "string" || body.receiptFooter.length > 300) throw new Error("Kağıt genişliği, yazdırma tercihi veya fiş metinleri geçersiz.");
  for (const key of ["showOrganization", "showBranch"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error("Fiş görünüm tercihleri geçersiz.");
  return { paperWidth: body.paperWidth as PrinterSettings["paperWidth"], receiptHeader: body.receiptHeader.trim(), receiptFooter: body.receiptFooter.trim(), afterSalePrint: body.afterSalePrint as PrinterSettings["afterSalePrint"], showOrganization: body.showOrganization !== false, showBranch: body.showBranch !== false };
}

export function findBarcodeProduct<T extends { barcode: string | null }>(products: readonly T[], barcode: string): T | undefined {
  const code = barcode.trim();
  return code ? products.find(product => product.barcode === code) : undefined;
}
