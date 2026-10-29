import { Prisma } from "@/generated/prisma/client";
import { CashError, cashAmount } from "@/lib/cash-management";
import { dateInput, text } from "@/lib/current-accounts";

export type ExpenseInput = {
  title: string; categoryId: string; amount: Prisma.Decimal; branchId: string;
  expenseDate: Date; dueDate: Date | null; description: string | null;
  reference: string | null; currentAccountId: string | null;
};
export const expenseFields = ["title", "categoryId", "amount", "expenseDate", "dueDate", "description", "reference", "currentAccountId"];
export function expenseInput(body: Record<string, unknown>): ExpenseInput {
  const expenseDate = dateInput(body.expenseDate);
  if (!expenseDate) throw new CashError("Gider tarihi zorunludur.");
  const dueDate = dateInput(body.dueDate, true) ?? null;
  if (dueDate && dueDate < expenseDate) throw new CashError("Vade tarihi gider tarihinden önce olamaz.");
  return {
    title: text(body.title, "gider başlığı", 200, true)!,
    categoryId: text(body.categoryId, "kategori", 200, true)!,
    branchId: text(body.branchId, "şube", 200, true)!,
    amount: cashAmount(body.amount), expenseDate, dueDate,
    description: text(body.description, "açıklama", 1000),
    reference: text(body.reference, "referans", 100),
    currentAccountId: text(body.currentAccountId, "cari hesap", 200),
  };
}
export function paymentTotals(amount: Prisma.Decimal, payments: { amount: Prisma.Decimal; cancelledAt?: Date | string | null; payment?: { cancelledAt?: Date | string | null } }[]) {
  const paid = payments.filter(p => !p.cancelledAt && !p.payment?.cancelledAt).reduce((total, p) => total.plus(p.amount), new Prisma.Decimal(0));
  if (paid.gt(amount)) throw new CashError("Giderin ödeme toplamı tutarı aşıyor.", 409);
  return { paidAmount: paid.toString(), remainingAmount: amount.minus(paid).toString(), paymentStatus: paid.eq(0) ? "UNPAID" : paid.eq(amount) ? "PAID" : "PARTIALLY_PAID" };
}
export function expenseVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new CashError("Geçerli gider sürümü gereklidir.");
  return value;
}
export function todayInIstanbul(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return dateInput(day)!;
}
