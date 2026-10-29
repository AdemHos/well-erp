export const reportTabs = { overview: "Genel Bakış", sales: "Satışlar", finance: "Finans", stock: "Stok", profit: "Kârlılık", customers: "Müşteriler", suppliers: "Tedarikçiler", branches: "Personel ve Şubeler" } as const;
export type ReportKey = keyof typeof reportTabs;
export const reportPresets = { today: "Bugün", yesterday: "Dün", last7: "Son 7 gün", last30: "Son 30 gün", month: "Bu ay", previousMonth: "Geçen ay", custom: "Özel tarih aralığı" };
const sourceLabels: Record<string, string> = { CUSTOMER: "Müşteri", SUPPLIER: "Tedarikçi", BOTH: "Müşteri ve tedarikçi", SALE: "Satış", RETURN: "İade", PURCHASE: "Alış", WASTE: "Fire", ADJUSTMENT_IN: "Stok düzeltme girişi", ADJUSTMENT_OUT: "Stok düzeltme çıkışı", TRANSFER_IN: "Transfer girişi", TRANSFER_OUT: "Transfer çıkışı", PRODUCTION_IN: "Üretim girişi", PRODUCTION_OUT: "Üretim tüketimi", POS_SALE: "POS satış kasa girişi", POS_REFUND: "POS iade kasa çıkışı", MANUAL: "Manuel kasa hareketi", PAYMENT: "Ödeme / tahsilat", PAYMENT_REVERSAL: "Ödeme / tahsilat ters kaydı", EXPENSE_PAYMENT: "Gider ödemesi" };
const unitLabels: Record<string, string> = { PIECE: "Adet", GRAM: "Gram", KILOGRAM: "Kilogram", MILLILITER: "Mililitre", LITER: "Litre" };
export function reportCellLabel(value: string | null, column: string, table: string) {
  if (value == null) return value;
  if (column === "unit") return unitLabels[value] ?? value;
  if (column === "type" || column === "name" && table === "flows") return sourceLabels[value] ?? value;
  return value;
}
