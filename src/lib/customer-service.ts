import { assertAccountIdentityAvailable } from "@/lib/account-identity";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { CashError, serialCashTransaction } from "@/lib/cash-management";
import { hasPermission, type Permission } from "@/lib/permissions";
import { hashRequest, keyInput, onlyFields } from "@/lib/current-accounts";
import { customerCreateFields, customerFields, customerInput, customerVersion, linkInput } from "@/lib/customers";
import { writeAudit } from "@/lib/audit";
import type { ActiveMembership } from "@/lib/auth-context";

export type CustomerContext = { params: Promise<{ id: string }> };
export async function customerActor(permission: Permission) {
  const actor = await currentActor();
  if (!hasPermission(actor.role, permission)) throw new CashError("Bu işlem için yetkiniz yok.", 403);
  return actor;
}
export function customerError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "Müşteri kodu, cari bağlantısı veya istek anahtarı zaten kullanılmış.", code: "DUPLICATE" }, { status: 409 });
    if (["P2021", "P2022"].includes(error.code) || (error.code === "P2010" && ["42P01", "42703"].includes(String(error.meta?.code)))) return NextResponse.json({ error: "Müşteriler veritabanı güncellemesi bekleniyor.", code: "SCHEMA_PENDING" }, { status: 503 });
    if (["P2025", "P2034"].includes(error.code)) return NextResponse.json({ error: "Kayıt değişti. Güncel bilgileri yükleyip tekrar deneyin." }, { status: 409 });
  }
  console.error("CUSTOMER_ERROR", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Müşteri işlemi tamamlanamadı. Sonucu aynı istekle doğrulayın." }, { status: 500 });
}
export async function customerRecord(tx: Prisma.TransactionClient, actor: ActiveMembership, id: string) {
  const customer = await tx.customer.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!customer) throw new CashError("Müşteri bulunamadı veya erişim yetkiniz yok.", 404);
  return customer;
}
async function accountFor(tx: Prisma.TransactionClient, actor: ActiveMembership, data: ReturnType<typeof customerInput>, link: ReturnType<typeof linkInput>, customerId?: string) {
  if (link.mode !== "none" && !hasPermission(actor.role, "finance.manage")) throw new CashError("Cari bağlantısı için finans yetkisi gerekiyor.", 403);
  const sameCode = await tx.currentAccount.findFirst({ where: { organizationId: actor.organizationId, code: data.code } });
  if (link.mode === "existing") {
    if (sameCode && sameCode.id !== link.accountId) throw new CashError("Müşteri kodu farklı bir cariye ait. Doğru cari bağlantısını seçin.", 409);
    const account = await tx.currentAccount.findFirst({ where: { id: link.accountId!, organizationId: actor.organizationId, isActive: true, type: { in: ["CUSTOMER", "BOTH"] }, customer: null } });
    if (!account) throw new CashError("Uygun, aktif ve başka müşteriye bağlı olmayan müşteri carisi seçin.", 409);
    return account.id;
  }
  // A matching accounting code must be linked explicitly instead of creating a second identity.
  if (sameCode) throw new CashError("Bu kodla mevcut cari var. Mevcut cariyi bağlama seçeneğini kullanın.", 409);
  if (link.mode === "none") return null;
  await assertAccountIdentityAvailable(tx, actor.organizationId, data.taxNumber);
  const account = await tx.currentAccount.create({ data: { organizationId: actor.organizationId, type: "CUSTOMER", code: data.code, name: data.name, phone: data.phone, email: data.email, address: data.address, taxOffice: data.taxOffice, taxNumber: data.taxNumber } });
  await writeAudit(tx, actor, "current-account.create", "CurrentAccount", account.id, undefined, { customerId: customerId ?? null });
  return account.id;
}
export async function createCustomer(request: NextRequest) {
  try {
    const actor = await customerActor("customers.manage"), body = await jsonBody(request);
    customerCreateFields(body);
    if (body.expectedOrganizationId !== undefined && body.expectedOrganizationId !== actor.organizationId) throw new CashError("İşletme değişmiş. İsteği oluşturduğunuz işletmeye dönüp sonucu doğrulayın.", 409);
    // Older API clients may still supply codes. New forms leave generation to the server.
    const automaticCode = body.code === undefined || body.code === "";
    const input = customerInput({ ...body, code: automaticCode ? "AUTO" : body.code });
    const link = linkInput(body), key = keyInput(body.idempotencyKey), hash = hashRequest({ data: automaticCode ? { ...input, code: null } : input, link });
    const work = () => serialCashTransaction(prisma, async tx => {
      const previous = await tx.customer.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } } });
      if (previous) {
        if (previous.requestHash !== hash) throw new CashError("İstek anahtarı farklı müşteri için kullanılmış.", 409);
        return { customer: previous, replayed: true };
      }
      const data = { ...input, code: automaticCode ? "MUS-" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase() : input.code };
      const currentAccountId = await accountFor(tx, actor, data, link);
      const customer = await tx.customer.create({ data: { ...data, currentAccountId, organizationId: actor.organizationId, idempotencyKey: key, requestHash: hash, createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null } });
      await writeAudit(tx, actor, "customer.create", "Customer", customer.id, undefined, { type: data.type, currentAccountId });
      return { customer, replayed: false };
    });
    let result;
    try { result = await work(); } catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e; result = await work(); }
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return customerError(error); }
}
export async function updateCustomer(request: NextRequest, context: CustomerContext) {
  try {
    const actor = await customerActor("customers.manage"), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, [...customerFields, "expectedVersion"]);
    const version = customerVersion(body.expectedVersion);
    const customer = await serialCashTransaction(prisma, async tx => {
      const saved = await customerRecord(tx, actor, id);
      if (saved.version !== version) throw new CashError("Müşteri değişti. Güncel kaydı yükleyin.", 409);
      const { expectedVersion: _version, ...patch } = body;
      void _version;
      if (!Object.keys(patch).length) throw new CashError("Değiştirilecek alan gönderin.");
      const data = customerInput({ ...saved, ...patch });
      if (data.code !== saved.code) {
        const conflict = await tx.currentAccount.findFirst({ where: { organizationId: actor.organizationId, code: data.code, ...(saved.currentAccountId ? { id: { not: saved.currentAccountId } } : {}) } });
        if (conflict) throw new CashError("Bu kod başka cari tarafından kullanılıyor.", 409);
      }
      const updated = await tx.customer.update({ where: { id, organizationId: actor.organizationId, version }, data: { ...data, version: { increment: 1 } } });
      await writeAudit(tx, actor, "customer.update", "Customer", id, undefined, { fields: Object.keys(patch), version: updated.version, isActive: updated.isActive });
      return updated;
    });
    return NextResponse.json({ customer });
  } catch (error) { return customerError(error); }
}
export async function linkCustomerAccount(request: NextRequest, context: CustomerContext) {
  try {
    const actor = await customerActor("customers.manage"), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["accountMode", "currentAccountId", "expectedVersion"]);
    const version = customerVersion(body.expectedVersion), link = linkInput(body);
    if (link.mode === "none") throw new CashError("Cari bağlantı yöntemi seçin.");
    const customer = await serialCashTransaction(prisma, async tx => {
      const saved = await customerRecord(tx, actor, id);
      if (saved.currentAccountId) throw new CashError("Mevcut cari bağlantısı değiştirilemez.", 409);
      if (saved.version !== version) throw new CashError("Müşteri değişti. Güncel kaydı yükleyin.", 409);
      const currentAccountId = await accountFor(tx, actor, customerInput(saved), link, id);
      const updated = await tx.customer.update({ where: { id, version }, data: { currentAccountId, version: { increment: 1 } } });
      await writeAudit(tx, actor, "customer.account.link", "Customer", id, undefined, { currentAccountId });
      return updated;
    });
    return NextResponse.json({ customer });
  } catch (error) { return customerError(error); }
}
