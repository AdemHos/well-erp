import { prisma } from "@/lib/prisma";
import { defaultPrinterSettings, parsePrinterSettings, type PrinterSettings } from "@/lib/integrations";
import { AccessError, type ActiveMembership } from "@/lib/auth-context";
import { branchIdScope, hasPermission, type Permission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

const fields = { paperWidth: true, receiptHeader: true, receiptFooter: true, afterSalePrint: true, showOrganization: true, showBranch: true } as const;
export const isPrinterSchemaMissing = (e: unknown) => !!e && typeof e === "object" && "code" in e && ["P2021", "P2022"].includes(String(e.code));
async function authorize(actor: ActiveMembership, branchId: string, write = false) {
  const readPermissions: Permission[] = ["integrations.read", "pos.sell", "orders.read", "restaurant.checkout"];
  const allowed = write ? hasPermission(actor.role, "integrations.manage") : readPermissions.some(p => hasPermission(actor.role, p));
  if (!allowed) throw new AccessError("Bu işlem için yetkiniz yok.", 403);
  const branch = await prisma.branch.findFirst({ where: { AND: [{ id: branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true } });
  if (!branch) throw new AccessError("Şube bulunamadı veya erişim yetkiniz yok.", 404);
}
export async function readPrinterSettings(actor: ActiveMembership, branchId: string): Promise<{ settings: PrinterSettings; storageReady: boolean }> {
  await authorize(actor, branchId);
  try {
    const row = await prisma.branchPrinterSetting.findFirst({ where: { organizationId: actor.organizationId, branchId }, select: fields });
    return { settings: row ? parsePrinterSettings(row) : { ...defaultPrinterSettings }, storageReady: true };
  } catch (e) {
    if (isPrinterSchemaMissing(e)) return { settings: { ...defaultPrinterSettings }, storageReady: false };
    throw e;
  }
}
export async function savePrinterSettings(actor: ActiveMembership, branchId: string, body: unknown) {
  await authorize(actor, branchId, true);
  let values: PrinterSettings;
  try { values = parsePrinterSettings(body); } catch (e) { throw new AccessError(e instanceof Error ? e.message : "Geçersiz ayarlar.", 400); }
  return prisma.$transaction(async tx => {
    const settings = await tx.branchPrinterSetting.upsert({ where: { branchId_organizationId: { branchId, organizationId: actor.organizationId } }, create: { organizationId: actor.organizationId, branchId, ...values }, update: values, select: fields });
    await writeAudit(tx, actor, "PRINTER_SETTINGS_UPDATED", "BranchPrinterSetting", branchId, branchId);
    return { settings: parsePrinterSettings(settings), storageReady: true };
  });
}
