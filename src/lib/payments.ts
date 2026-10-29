export const paymentTypes = {
  CUSTOMER_COLLECTION: "Müşteriden tahsilat",
  SUPPLIER_PAYMENT: "Tedarikçiye ödeme",
  EXPENSE_PAYMENT: "Gider ödemesi",
  PURCHASE_INVOICE_PAYMENT: "Alış faturası ödemesi",
  SALES_INVOICE_COLLECTION: "Satış faturası tahsilatı",
} as const;
export type PaymentKind = keyof typeof paymentTypes;
export function isCollection(type: PaymentKind) {
  return type === "CUSTOMER_COLLECTION" || type === "SALES_INVOICE_COLLECTION";
}
