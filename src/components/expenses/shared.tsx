"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/current-accounts/shared";
export { api, button, secondary, panel, input, money, date, Notice, Stat, Pager } from "@/components/current-accounts/shared";
export type Category = { id: string; name: string; direction: "IN" | "OUT"; isActive: boolean };
export type Branch = { id: string; name: string };
export type Supplier = { id: string; code: string; name: string; type: "CUSTOMER" | "SUPPLIER" | "BOTH"; isActive: boolean };
export type ExpenseRow = {
  id: string; branchId: string; title: string; amount: string; paidAmount: string; remainingAmount: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID"; expenseDate: string; dueDate: string | null;
  description: string | null; reference: string | null; categoryId: string; currentAccountId: string | null;
  branchName?: string; categoryName?: string; currentAccountName?: string; version: number; cancelledAt: string | null;
};
export type Payment = { cancelledAt: string | null; id: string; amount: string; paidAt: string; description: string | null; reference: string | null;
  financeTransactionId: string; currentAccountEntryId: string | null;
  financeTransaction: { account: { id: string; name: string; type: string } };
  createdBy: { name: string | null }; createdByProfile: { name: string } | null;
};
export type ExpenseDetail = ExpenseRow & { branch: Branch; category: Category; currentAccount: Supplier | null; payments: Payment[]; cancellationReason: string | null };
export const statuses = { UNPAID: "Ödenmedi", PARTIALLY_PAID: "Kısmen ödendi", PAID: "Ödendi" };
export const calendarDay = (value?: string | null) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
export const categorySuggestions = ["Kira", "Elektrik", "Su", "Doğalgaz", "İnternet ve telefon", "Personel", "Bakım ve onarım", "Temizlik", "Pazarlama ve reklam", "Vergi ve harçlar", "Diğer"];
type Pending = { body: Record<string, unknown>; key: string };
export function useExpenseMutation(url: string, onDone: (result: { expense?: ExpenseRow }) => void, enabled = true, scope?: string) {
  const storageKey = "wellpos.expense.pending." + url + (scope ? ":" + scope : "");
  const [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef<Pending | null>(null), lock = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try { const raw = sessionStorage.getItem(storageKey); const value = raw ? JSON.parse(raw) : null;
        if (value && value.body && typeof value.body === "object" && typeof value.key === "string") { current.current = value; setPending(true); }
      } catch { /* Storage is optional; in-memory request keys remain stable. */ }
    });
    return () => { cancelled = true; };
  }, [storageKey, enabled]);
  const run = useCallback(async (body?: Record<string, unknown>) => {
    if (!enabled || lock.current) return;
    const request = current.current ?? (body ? { body, key: crypto.randomUUID() } : null);
    if (!request) return;
    current.current = request; setPending(true); lock.current = true; setBusy(true); setError("");
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)); } catch {}
    const clear = () => { current.current = null; setPending(false); try { sessionStorage.removeItem(storageKey); } catch {} };
    try { const result = await api<{ expense?: ExpenseRow }>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request.body, idempotencyKey: request.key }) }); clear(); onDone(result); }
    catch (error) { if (error instanceof ApiError && error.status < 500) clear(); setError(error instanceof Error ? error.message : "İşlem sonucu doğrulanamadı."); }
    finally { lock.current = false; setBusy(false); }
  }, [url, storageKey, onDone, enabled]);
  return { run, pending, busy, error };
}
