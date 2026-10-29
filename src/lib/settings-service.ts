import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessError, type ActiveMembership } from "@/lib/auth-context";
import { branchIdScope, hasPermission, hasAllBranches } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { businessFields, parseBusinessInfo, parseSection, type BusinessInfo, type SettingSection } from "@/lib/settings";
import { branchPolicy, settingsReady } from "@/lib/settings-policy";
import { CashError } from "@/lib/cash-management";

export const businessSelect = Object.fromEntries(Object.keys(businessFields).map(k => [k, true])) as Record<keyof BusinessInfo, true>;
export async function settingsBranch(actor: ActiveMembership, branchId: string, write = false) {
  if (!hasPermission(actor.role, write ? "settings.branch.manage" : "settings.read")) throw new AccessError("Bu işlem için yetkiniz yok.", 403);
  const branch = await prisma.branch.findFirst({ where: { AND: [{ organizationId: actor.organizationId, id: branchId }, branchIdScope(actor)] }, select: { id: true, name: true } });
  if (!branch) throw new AccessError("Şube bulunamadı veya erişim yetkiniz yok.", 404);
  return branch;
}
export async function readBusiness(actor: ActiveMembership) {
  if (!hasPermission(actor.role, "settings.organization.manage") || !hasAllBranches(actor)) throw new AccessError("İşletme bilgilerine erişim yetkiniz yok.", 403);
  const row = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: businessSelect });
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ""])) as BusinessInfo;
}
export async function saveBusiness(actor: ActiveMembership, body: unknown) {
  if (!hasPermission(actor.role, "settings.organization.manage") || !hasAllBranches(actor)) throw new AccessError("İşletme bilgilerini değiştirme yetkiniz yok.", 403);
  let values: BusinessInfo;
  try { values = parseBusinessInfo(body); } catch (e) { throw new AccessError(e instanceof Error ? e.message : "İşletme bilgileri geçersiz.", 400); }
  return prisma.$transaction(async tx => {
    if (!await settingsReady(tx)) throw new AccessError("Ayarlar veritabanı güncellemesi bekleniyor.", 503);
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${actor.organizationId} FOR UPDATE`;
    const before = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: businessSelect });
    const changedFields = Object.keys(values).filter(k => values[k as keyof BusinessInfo] !== (before[k as keyof BusinessInfo] ?? ""));
    if (!changedFields.length) return values;
    await tx.order.updateMany({ where: { organizationId: actor.organizationId, businessSnapshot: { equals: Prisma.DbNull } }, data: { businessSnapshot: before } });
    // Existing issued invoice snapshots remain untouched. Legacy null snapshots freeze their name.
    await tx.$executeRaw`UPDATE "Invoice" SET snapshot=jsonb_build_object('organizationName', ${before.name}::text) WHERE "organizationId"=${actor.organizationId} AND status <> 'DRAFT' AND snapshot IS NULL`;
    await tx.organization.update({ where: { id: actor.organizationId }, data: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === "name" ? v : v || null])) });
    await writeAudit(tx, actor, "ORGANIZATION_SETTINGS_UPDATED", "Organization", actor.organizationId, undefined, { changedFields });
    return values;
  });
}
export async function readBranchSettings(actor: ActiveMembership, branchId: string) {
  await settingsBranch(actor, branchId);
  return { settings: await branchPolicy(prisma, actor.organizationId, branchId), storageReady: await settingsReady(prisma) };
}
export async function saveBranchSection(actor: ActiveMembership, branchId: string, section: SettingSection, body: unknown) {
  await settingsBranch(actor, branchId, true);
  let values: ReturnType<typeof parseSection>;
  try { values = parseSection(section, body); } catch (e) { throw new AccessError(e instanceof Error ? e.message : "Ayarlar geçersiz.", 400); }
  // Financial/security policies require OWNER or ADMIN; MANAGER can tune branch notifications.
  if (section !== "notifications" && !hasPermission(actor.role, "settings.policy.manage")) throw new AccessError("Kritik şube politikalarını yalnızca OWNER / ADMIN değiştirebilir.", 403);
  return prisma.$transaction(async tx => {
    if (!await settingsReady(tx)) throw new AccessError("Ayarlar veritabanı güncellemesi bekleniyor.", 503);
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${actor.organizationId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id=${branchId} AND "organizationId"=${actor.organizationId} FOR UPDATE`;
    const before = await branchPolicy(tx, actor.organizationId, branchId);
    const changedFields = Object.keys(values).filter(k => JSON.stringify(values[k as keyof typeof values]) !== JSON.stringify(before[k as keyof typeof before]));
    await tx.branchSettings.upsert({ where: { branchId_organizationId: { branchId, organizationId: actor.organizationId } }, create: { branchId, organizationId: actor.organizationId, ...values }, update: values });
    await writeAudit(tx, actor, "BRANCH_SETTINGS_UPDATED", "BranchSettings", branchId, branchId, { section, changedFields });
    return { settings: await branchPolicy(tx, actor.organizationId, branchId), storageReady: true };
  });
}
export function settingsJson(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
export function settingsError(e: unknown) {
  if (e instanceof AccessError || e instanceof CashError) return settingsJson({ error: e.message }, e.status);
  if (e && typeof e === "object" && "code" in e && ["P2021", "P2022"].includes(String(e.code))) return settingsJson({ error: "Ayarlar veritabanı güncellemesi bekleniyor." }, 503);
  return settingsJson({ error: "Ayarlar işlenemedi. Yenileyip tekrar deneyin." }, 500);
}
export async function settingsBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError("JSON veri gönderin.", 415);
  const text = await request.text(); if (Buffer.byteLength(text) > 8192) throw new AccessError("İstek verisi çok büyük.", 413);
  try { return JSON.parse(text) as unknown; } catch { throw new AccessError("Geçersiz JSON.", 400); }
}
