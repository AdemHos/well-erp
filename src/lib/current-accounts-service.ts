import { assertAccountIdentityAvailable, supplierSchemaReady } from "@/lib/account-identity";
import { customerSchemaReady } from "@/lib/customer-schema";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { type ActiveMembership } from "@/lib/auth-context";
import { branchScope, branchIdScope } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { CashError, cashAmount, serialCashTransaction } from "@/lib/cash-management";
import { accountTypes, balanceLabel, cardData, dateInput, hashRequest, keyInput, objectBody, onlyFields, pagination, text } from "@/lib/current-accounts";

export type AccountContext = { params: Promise<{ id: string; entryId?: string }> };
// Keep existing cari operations compatible until the separately approved
// Expense migration adds expenseId. Do not implicitly select that new column.
const currentEntrySelect = {
  id: true, organizationId: true, currentAccountId: true, branchId: true,
  direction: true, kind: true, amount: true, description: true, reference: true,
  occurredAt: true, createdAt: true, createdByUserId: true, createdByProfileId: true,
  idempotencyKey: true, requestHash: true, reversalOfId: true,
  financeTransactionId: true, sourceKey: true, dueAt: true,
} satisfies Prisma.CurrentAccountEntrySelect;
export async function currentActor() {
  const actor = await getCurrentMembership();
  if (!actor) throw new CashError("Oturum açmanız gerekiyor.", 401);
  return actor;
}
export async function currentCard(tx: Prisma.TransactionClient, actor: ActiveMembership, id: string) {
  const card = await tx.currentAccount.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!card) throw new CashError("Cari hesap bulunamadı.", 404);
  return card;
}
export function currentError(error: unknown) {
  if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "Cari kodu, açılış veya işlem anahtarı zaten kullanılmış.", code: "DUPLICATE" }, { status: 409 });
    if (["P2021", "P2022"].includes(error.code)) return NextResponse.json({ error: "Cari hesap veritabanı kurulumu henüz uygulanmamış.", code: "SCHEMA_PENDING" }, { status: 503 });
  }
  console.error("CURRENT_ACCOUNT_ERROR", error);
  return NextResponse.json({ error: "Cari hesap işlemi tamamlanamadı." }, { status: 500 });
}
export async function jsonBody(request: NextRequest) {
  try { return objectBody(await request.json()); }
  catch (error) { if (error instanceof CashError) throw error; throw new CashError("Geçerli JSON gönderin."); }
}
export async function listAccounts(request: NextRequest) {
  try {
    const actor = await currentActor();
    const params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params);
    const q = text(params.get("q"), "arama", 200);
    const type = params.get("type"), active = params.get("active");
    if (type && !accountTypes.includes(type as typeof accountTypes[number])) throw new CashError("Geçersiz cari türü.");
    if (active && !["true", "false", "all"].includes(active)) throw new CashError("Geçersiz aktiflik filtresi.");
    const result = await prisma.$transaction(async tx => {
      const where: Prisma.CurrentAccountWhereInput = {
        organizationId: actor.organizationId,
        ...(type ? { type: { in: type === "BOTH" ? ["BOTH"] : [type as "CUSTOMER" | "SUPPLIER", "BOTH"] } } : {}),
        ...(active && active !== "all" ? { isActive: active === "true" } : {}),
        ...(q ? { OR: ["code", "name", "phone", "email"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) } : {}),
      };
      const [cards, count, groups, types] = await Promise.all([
        tx.currentAccount.findMany({ where, orderBy: [{ code: "asc" }, { id: "asc" }], skip, take: limit }),
        tx.currentAccount.count({ where }),
        tx.currentAccountEntry.groupBy({ by: ["currentAccountId", "direction"], where: { organizationId: actor.organizationId, ...branchScope(actor) }, _sum: { amount: true } }),
        tx.currentAccount.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, type: true, isActive: true } }),
      ]);
      const totals = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
      for (const row of groups) {
        const value = totals.get(row.currentAccountId) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
        if (row.direction === "DEBIT") value.debit = value.debit.plus(row._sum.amount ?? 0);
        else value.credit = value.credit.plus(row._sum.amount ?? 0);
        totals.set(row.currentAccountId, value);
      }
      let receivable = new Prisma.Decimal(0), payable = new Prisma.Decimal(0);
      for (const card of types) {
        const t = totals.get(card.id);
        const balance = (t?.debit ?? new Prisma.Decimal(0)).minus(t?.credit ?? 0);
        if (card.type !== "SUPPLIER" && balance.gt(0)) receivable = receivable.plus(balance);
        if (card.type !== "CUSTOMER" && balance.lt(0)) payable = payable.minus(balance);
      }
      return {
        accounts: cards.map(card => {
          const t = totals.get(card.id) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
          const balance = t.debit.minus(t.credit);
          return { ...card, totalDebit: t.debit.toString(), totalCredit: t.credit.toString(), balance: balance.toString(), balanceSide: balanceLabel(balance) };
        }),
        summary: { receivable: receivable.toString(), payable: payable.toString(), activeCount: types.filter(card => card.isActive).length },
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ success: true, ...result });
  } catch (error) { return currentError(error); }
}

export async function createAccount(request: NextRequest) {
  try {
    const actor = await currentActor();
    const data = cardData(await jsonBody(request));
    const account = await serialCashTransaction(prisma, async tx => {
      await assertAccountIdentityAvailable(tx, actor.organizationId, typeof data.taxNumber === "string" ? data.taxNumber : null);
      const card = await tx.currentAccount.create({ data: { ...data, organizationId: actor.organizationId } as Prisma.CurrentAccountUncheckedCreateInput });
      await writeAudit(tx, actor, "current-account.create", "CurrentAccount", card.id, undefined, { code: card.code });
      return card;
    });
    return NextResponse.json({ success: true, account }, { status: 201 });
  } catch (error) { return currentError(error); }
}

export async function getAccount(_request: NextRequest, context: AccountContext) {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const account = await currentCard(prisma, actor, id);
    return NextResponse.json({ success: true, account });
  } catch (error) { return currentError(error); }
}

export async function updateAccount(request: NextRequest, context: AccountContext) {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const data = cardData(await jsonBody(request), true);
    const account = await serialCashTransaction(prisma, async tx => {
      await currentCard(tx, actor, id);
      if (data.type === "SUPPLIER" && await customerSchemaReady(tx) && await tx.customer.findFirst({ where: { currentAccountId: id, organizationId: actor.organizationId }, select: { id: true } })) throw new CashError("Müşteriye bağlı cari yalnız CUSTOMER veya BOTH olabilir.", 409);
      if (data.type === "CUSTOMER" && await supplierSchemaReady(tx) && await tx.supplier.findFirst({ where: { currentAccountId: id, organizationId: actor.organizationId }, select: { id: true } })) throw new CashError("Tedarikçiye bağlı cari yalnız SUPPLIER veya BOTH olabilir.", 409);
      if (typeof data.taxNumber === "string") await assertAccountIdentityAvailable(tx, actor.organizationId, data.taxNumber, id);
      const card = await tx.currentAccount.update({ where: { id, organizationId: actor.organizationId }, data });
      await writeAudit(tx, actor, "current-account.update", "CurrentAccount", id, undefined, { fields: Object.keys(data), isActive: card.isActive });
      return card;
    });
    return NextResponse.json({ success: true, account });
  } catch (error) { return currentError(error); }
}

export async function createAccountEntry(request: NextRequest, context: AccountContext) {
  return writeEntry(request, context, false);
}
export async function reverseAccountEntry(request: NextRequest, context: AccountContext) {
  return writeEntry(request, context, true);
}

async function writeEntry(request: NextRequest, context: AccountContext, reversing: boolean) {
  try {
    const actor = await currentActor(), { id, entryId } = await context.params;
    const body = await jsonBody(request);
    onlyFields(body, reversing ? ["idempotencyKey", "description", "reference", "occurredAt"] : ["branchId", "kind", "direction", "amount", "description", "reference", "occurredAt", "idempotencyKey"]);
    const key = keyInput(body.idempotencyKey);
    const description = text(body.description, "açıklama", 1000, reversing || body.kind === "ADJUSTMENT");
    const reference = text(body.reference, "referans", 100);
    const occurredAt = dateInput(body.occurredAt);
    if (!reversing && (typeof body.kind !== "string" || !["OPENING", "ADJUSTMENT"].includes(body.kind))) throw new CashError("Yalnızca açılış veya manuel düzeltme eklenebilir.");
    if (!reversing && (typeof body.direction !== "string" || !["DEBIT", "CREDIT"].includes(body.direction))) throw new CashError("Geçersiz borç/alacak yönü.");
    const amount = reversing ? undefined : cashAmount(body.amount);
    const branchId = reversing ? undefined : text(body.branchId, "şube", 200, true)!;
    const hash = hashRequest({ id, entryId: reversing ? entryId : null, branchId: branchId ?? null, kind: reversing ? "REVERSAL" : body.kind, direction: reversing ? null : body.direction, amount: amount?.toString() ?? null, description, reference, occurredAt: occurredAt?.toISOString() ?? null });
    const run = () => serialCashTransaction(prisma, async tx => {
      const card = await currentCard(tx, actor, id);
      const original = reversing ? await tx.currentAccountEntry.findFirst({ where: { id: entryId, organizationId: actor.organizationId, currentAccountId: id, ...branchScope(actor) }, select: currentEntrySelect }) : null;
      if (reversing && !original) throw new CashError("Hareket bulunamadı.", 404);
      const branch = await tx.branch.findFirst({ where: { AND: [{ id: original?.branchId ?? branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true } });
      if (!branch) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
      const previous = await tx.currentAccountEntry.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } }, select: currentEntrySelect });
      if (previous) {
        if (previous.requestHash !== hash) throw new CashError("İstek anahtarı farklı bir işlem için kullanılmış.", 409);
        return { entry: previous, replayed: true };
      }
      if (original) {
        if (!["OPENING", "ADJUSTMENT"].includes(original.kind) || original.financeTransactionId || original.sourceKey) throw new CashError("Bağlantılı finans hareketi kendi kaynak modülünden düzeltilmelidir.", 409);
        if (await tx.currentAccountEntry.findUnique({ where: { reversalOfId: original.id }, select: currentEntrySelect })) throw new CashError("Bu hareket zaten ters kaydedildi.", 409);
        if (occurredAt && occurredAt < original.occurredAt) throw new CashError("Ters kayıt tarihi orijinal hareketten önce olamaz.");
      } else {
        if (!card.isActive) throw new CashError("Pasif cariye yeni hareket eklenemez.", 409);
        if (body.kind === "OPENING" && await tx.currentAccountEntry.count({ where: { organizationId: actor.organizationId, currentAccountId: id, branchId: branch.id, kind: "OPENING" } })) throw new CashError("Bu şube için açılış zaten girilmiş. Düzeltme hareketi kullanın.", 409);
      }
      const entry = await tx.currentAccountEntry.create({ data: {
        organizationId: actor.organizationId, currentAccountId: id, branchId: branch.id,
        kind: reversing ? "REVERSAL" : body.kind as "OPENING" | "ADJUSTMENT",
        direction: original ? (original.direction === "DEBIT" ? "CREDIT" : "DEBIT") : body.direction as "DEBIT" | "CREDIT",
        amount: original?.amount ?? amount!, description, reference,
        occurredAt: occurredAt ?? (original && original.occurredAt > new Date() ? original.occurredAt : new Date()),
        createdByUserId: actor.userId, createdByProfileId: actor.profileId ?? null,
        idempotencyKey: key, requestHash: hash, reversalOfId: original?.id ?? null,
      }, select: currentEntrySelect });
      await writeAudit(tx, actor, reversing ? "current-account.entry.reverse" : "current-account.entry.create", "CurrentAccountEntry", entry.id, branch.id, { currentAccountId: id, kind: entry.kind, direction: entry.direction, amount: entry.amount.toString(), reversalOfId: original?.id ?? null });
      return { entry, replayed: false };
    });
    let result;
    try { result = await run(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      result = await run();
    }
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return currentError(error); }
}
