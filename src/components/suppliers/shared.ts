export { api, ApiError, button, secondary, panel, input, money, date, Notice, Stat, Pager, side } from "@/components/current-accounts/shared";
export { calendarDay } from "@/components/expenses/shared";
export type Supplier = {
  organizationId: string; id: string; contactName: string | null; website: string | null; code: string; name: string;
  phone: string | null; email: string | null; address: string | null; city: string | null; district: string | null;
  taxOffice: string | null; taxNumber: string | null; notes: string | null;
  isActive: boolean; currentAccountId?: string | null; version: number; createdAt: string;
};
export type AccountOption = { id: string; name: string; code: string; phone: string | null; email: string | null; address: string | null; taxOffice: string | null; taxNumber: string | null };
export type SupplierOptions = { accounts: AccountOption[]; matches?: { id: string; name: string; code: string }[]; canFinance: boolean };

export type ProductOption = { id: string; name: string; sku: string | null; unit: string; isSellable: boolean };
