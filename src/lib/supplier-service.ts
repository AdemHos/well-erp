import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { CashError, serialCashTransaction } from "@/lib/cash-management";
import { hasPermission, type Permission } from "@/lib/permissions";
import { hashRequest, keyInput, onlyFields } from "@/lib/current-accounts";
import { supplierCreateFields, supplierFields, supplierInput, supplierVersion, linkInput } from "@/lib/suppliers";
import { assertAccountIdentityAvailable } from "@/lib/account-identity";
import { writeAudit } from "@/lib/audit";
import type { ActiveMembership } from "@/lib/auth-context";
import type { Supplier } from "@/generated/prisma/client";

function publicSupplier(supplier: Supplier, role: string) {
  const { requestHash, idempotencyKey, createdByUserId, createdByProfileId, currentAccountId, ...profile } = supplier;
  void requestHash; void idempotencyKey; void createdByUserId; void createdByProfileId;
  return { ...profile, ...(hasPermission(role, "finance.manage") ? { currentAccountId } : {}) };
}

export type SupplierContext = { params: Promise<{ id: string }> };
export async function supplierActor(permission: Permission) {
  const actor = await currentActor();
  if (!hasPermission(actor.role, permission)) throw new CashError("Bu işlem için yetkiniz yok.", 403);
  return actor;
}
export function supplierError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "Tedarikçi kodu, cari bağlantısı veya istek anahtarı zaten kullanılmış.", code: "DUPLICATE" }, { status: 409 });
    if (["P2021", "P2022"].includes(error.code) || (error.code === "P2010" && ["42P01", "42703"].includes(String(error.meta?.code)))) return NextResponse.json({ error: "Tedarikçiler veritabanı güncellemesi bekleniyor.", code: "SCHEMA_PENDING" }, { status: 503 });
    if (["P2025", "P2034"].includes(error.code)) return NextResponse.json({ error: "Kayıt değişti. Güncel bilgileri yükleyip tekrar deneyin." }, { status: 409 });
  }
  console.error("SUPPLIER_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Tedarikçi işlemi tamamlanamadı. Sonucu aynı istekle doğrulayın." }, { status: 500 });
}
export async function supplierRecord(tx: Prisma.TransactionClient, actor: ActiveMembership, id: string) {
  const supplier = await tx.supplier.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!supplier) throw new CashError("Tedarikçi bulunamadı veya erişim yetkiniz yok.", 404);
  return supplier;
}
async function accountFor(tx: Prisma.TransactionClient, actor: ActiveMembership, data: ReturnType<typeof supplierInput>, link: ReturnType<typeof linkInput>, supplierId?: string) {
  if (link.mode !== "none" && !hasPermission(actor.role, "finance.manage")) throw new CashError("Cari bağlantısı için finans yetkisi gerekiyor.", 403);
  const sameCode = await tx.currentAccount.findFirst({ where: { organizationId: actor.organizationId, code: data.code } });
  if (link.mode === "existing") {
    if (sameCode && sameCode.id !== link.accountId) throw new CashError("Tedarikçi kodu farklı bir cariye ait. Doğru cari bağlantısını seçin.", 409);
    const account = await tx.currentAccount.findFirst({ where: { id: link.accountId!, organizationId: actor.organizationId, isActive: true, type: { in: ["SUPPLIER", "BOTH"] }, supplier: null } });
    if (!account) throw new CashError("Uygun, aktif ve başka tedarikçiye bağlı olmayan tedarikçi carisi seçin.", 409);
    if (data.taxNumber && account.taxNumber && data.taxNumber !== account.taxNumber) throw new CashError("Tedarikçi ve cari vergi numarası / TCKN eşleşmiyor. Doğru firmayı seçin.", 409);
    return account.id;
  }
  // A matching accounting code must be linked explicitly instead of creating a second identity.
  if (sameCode && link.mode !== "none") throw new CashError("Bu kodla mevcut cari var. Mevcut cariyi bağlama seçeneğini kullanın.", 409);
  if (link.mode === "none") return null;
  await assertAccountIdentityAvailable(tx, actor.organizationId, data.taxNumber);
  const account = await tx.currentAccount.create({ data: { organizationId: actor.organizationId, type: "SUPPLIER", code: data.code, name: data.name, phone: data.phone, email: data.email, address: data.address, taxOffice: data.taxOffice, taxNumber: data.taxNumber } });
  await writeAudit(tx, actor, "current-account.create", "CurrentAccount", account.id, undefined, { supplierId: supplierId ?? null });
  return account.id;
}
export async function createSupplier(request: NextRequest) {
  try {
    const actor = await supplierActor("suppliers.manage"), body = await jsonBody(request);
    supplierCreateFields(body);
    if (body.expectedOrganizationId !== undefined && body.expectedOrganizationId !== actor.organizationId) throw new CashError("İşletme değişmiş. İsteği oluşturduğunuz işletmeye dönüp sonucu doğrulayın.", 409);
    // Explicit codes are supported; an omitted code is generated on the server.
    const automaticCode = body.code === undefined || body.code === "";
    const input = supplierInput({ ...body, code: automaticCode ? "AUTO" : body.code });
    const link = linkInput(body), key = keyInput(body.idempotencyKey), hash = hashRequest({ data: automaticCode ? { ...input, code: null } : input, link });
    const work = () => serialCashTransaction(prisma, async tx => {
      const previous = await tx.supplier.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } } });
      if (previous) {
        if (previous.requestHash !== hash) throw new CashError("İstek anahtarı farklı tedarikçi için kullanılmış.", 409);
        return { supplier: previous, replayed: true };
      }
      const data = { ...input, code: automaticCode ? "TED-" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() : input.code };
      const currentAccountId = await accountFor(tx, actor, data, link);
      const supplier = await tx.supplier.create({ data: { ...data, currentAccountId, organizationId: actor.organizationId, idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      await writeAudit(tx, actor, "supplier.create", "Supplier", supplier.id, undefined, { currentAccountId });
      return { supplier, replayed: false };
    });
    let result;
    try { result = await work(); } catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e; result = await work(); }
    return NextResponse.json({ ...result, supplier: publicSupplier(result.supplier, actor.role) }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return supplierError(error); }
}
export async function updateSupplier(request: NextRequest, context: SupplierContext) {
  try {
    const actor = await supplierActor("suppliers.manage"), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, [...supplierFields, "expectedVersion"]);
    const version = supplierVersion(body.expectedVersion);
    const supplier = await serialCashTransaction(prisma, async tx => {
      const saved = await supplierRecord(tx, actor, id);
      if (saved.version !== version) throw new CashError("Tedarikçi değişti. Güncel kaydı yükleyin.", 409);
      const { expectedVersion: _version, ...patch } = body;
      void _version;
      if (!Object.keys(patch).length) throw new CashError("Değiştirilecek alan gönderin.");
      const data = supplierInput({ ...saved, ...patch });
      if (data.code !== saved.code) {
        const conflict = await tx.currentAccount.findFirst({ where: { organizationId: actor.organizationId, code: data.code, ...(saved.currentAccountId ? { id: { not: saved.currentAccountId } } : {}) } });
        if (conflict) throw new CashError("Bu kod başka cari tarafından kullanılıyor.", 409);
      }
      const updated = await tx.supplier.update({ where: { id, organizationId: actor.organizationId, version }, data: { ...data, version: { increment: 1 } } });
      await writeAudit(tx, actor, "supplier.update", "Supplier", id, undefined, { fields: Object.keys(patch), version: updated.version, isActive: updated.isActive });
      return updated;
    });
    return NextResponse.json({ supplier: publicSupplier(supplier, actor.role) });
  } catch (error) { return supplierError(error); }
}
export async function linkSupplierAccount(request: NextRequest, context: SupplierContext) {
  try {
    const actor = await supplierActor("suppliers.manage"), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["accountMode", "currentAccountId", "expectedVersion"]);
    const version = supplierVersion(body.expectedVersion), link = linkInput(body);
    if (link.mode === "none") throw new CashError("Cari bağlantı yöntemi seçin.");
    const supplier = await serialCashTransaction(prisma, async tx => {
      const saved = await supplierRecord(tx, actor, id);
      if (saved.currentAccountId) throw new CashError("Mevcut cari bağlantısı değiştirilemez.", 409);
      if (saved.version !== version) throw new CashError("Tedarikçi değişti. Güncel kaydı yükleyin.", 409);
      const currentAccountId = await accountFor(tx, actor, supplierInput(saved), link, id);
      const updated = await tx.supplier.update({ where: { id, version }, data: { currentAccountId, version: { increment: 1 } } });
      await writeAudit(tx, actor, "supplier.account.link", "Supplier", id, undefined, { currentAccountId });
      return updated;
    });
    return NextResponse.json({ supplier: publicSupplier(supplier, actor.role) });
  } catch (error) { return supplierError(error); }
}
