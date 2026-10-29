import { Prisma } from "@/generated/prisma/client";
import { defaultBranchSettings, type BranchSettingsValue } from "@/lib/settings";
import { CashError } from "@/lib/cash-management";

type DB = Prisma.TransactionClient;
export async function settingsReady(db: DB) {
  // Supports the client/schema transition before the approved migration is deployed.
  if (!db.branchSettings) return false;
  const [row] = await db.$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public."BranchSettings"') IS NOT NULL AS ready`;
  return row?.ready === true;
}
export async function branchPolicy(db: DB, organizationId: string, branchId: string, lock = false): Promise<BranchSettingsValue> {
  if (!await settingsReady(db)) return { ...defaultBranchSettings };
  if (lock) {
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "Branch" WHERE id=${branchId} AND "organizationId"=${organizationId} FOR SHARE`;
  }
  const row = await db.branchSettings.findFirst({ where: { organizationId, branchId } });
  if (!row) return { ...defaultBranchSettings };
  return { defaultPaymentMethod: row.defaultPaymentMethod as "CASH" | "CARD", discountRoles: row.discountRoles, maxDiscountPercent: row.maxDiscountPercent, refundRoles: row.refundRoles, refundReasonRequired: row.refundReasonRequired, customerSelection: row.customerSelection as BranchSettingsValue["customerSelection"], allowNegativeStock: row.allowNegativeStock, criticalStockEnabled: row.criticalStockEnabled, defaultCriticalLevel: row.defaultCriticalLevel.toString(), notificationsEnabled: row.notificationsEnabled, waiterNotification: row.waiterNotification, billNotification: row.billNotification, criticalStockNotification: row.criticalStockNotification, notificationSound: row.notificationSound };
}
export function assertSalePolicy(policy: BranchSettingsValue, role: string, subtotal: Prisma.Decimal, amount: Prisma.Decimal, customerId: string | null, percent?: Prisma.Decimal) {
  if (amount.gt(0)) {
    if (!policy.discountRoles.includes(role)) throw new CashError("Bu şubede indirim uygulama yetkiniz yok.", 403);
    if (percent ? percent.gt(policy.maxDiscountPercent) : amount.mul(100).gt(subtotal.mul(policy.maxDiscountPercent))) throw new CashError(`Bu şubede en fazla %${policy.maxDiscountPercent} indirim uygulanabilir.`, 400);
  }
  if (policy.customerSelection === "REQUIRED" && !customerId) throw new CashError("Bu şubede POS satışında müşteri seçimi zorunludur.", 400);
  if (policy.customerSelection === "HIDDEN" && customerId) throw new CashError("Bu şubede POS müşteri seçimi kapalıdır.", 400);
}
export async function businessSnapshot(db: DB, organizationId: string) {
  if (!await settingsReady(db)) return undefined;
  // Lock order is Organization -> Branch throughout settings and sales.
  await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR SHARE`;
  return db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, legalName: true, businessType: true, phone: true, email: true, website: true, address: true, city: true, district: true, taxOffice: true, taxNumber: true, logoUrl: true } });
}
