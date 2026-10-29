import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchScope } from "@/lib/permissions";
import { withPermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { assertCashAvailable, CashError, cashAmount, serialCashTransaction, transferIds } from "@/lib/cash-management";

export const runtime = "nodejs";
export const POST = withPermission("finance.manage", async (request: NextRequest) => {
  try {
    const member = await getCurrentMembership();
    if (!member) return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CashError("Geçersiz istek.");
    const { fromAccountId, toAccountId, idempotencyKey } = body;
    if (![fromAccountId, toAccountId].every(id => typeof id === "string" && id.length > 0 && id.length <= 200)) throw new CashError("Kaynak ve hedef hesap seçin.");
    if (fromAccountId === toAccountId) throw new CashError("Aynı hesaba transfer yapılamaz.");
    if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) throw new CashError("Geçerli bir transfer istek anahtarı gereklidir.");
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 500)) throw new CashError("Açıklama en fazla 500 karakter olabilir.");
    const description = body.description?.trim() || null;
    const amount = cashAmount(body.amount);
    const ids = transferIds(member.organizationId, idempotencyKey);
    const execute = () => serialCashTransaction(prisma, async tx => {
      // Access to both accounts is checked even for replays after deactivation.
      const accounts = await tx.financeAccount.findMany({ where: { AND: [{ id: { in: [fromAccountId, toAccountId] }, organizationId: member.organizationId }, branchScope(member)] } });
      const from = accounts.find(account => account.id === fromAccountId);
      const to = accounts.find(account => account.id === toAccountId);
      if (!from || !to) throw new CashError("Hesap bulunamadı veya erişim yetkiniz yok.", 404);
      const previous = await tx.financeTransaction.findMany({ where: { id: { in: [ids.out, ids.in] }, organizationId: member.organizationId } });
      if (previous.length) {
        const matches = previous.length === 2 && previous.every(entry => entry.amount.eq(amount) && entry.description === description && entry.reference === ids.reference && entry.source === "MANUAL" && (entry.id === ids.out ? entry.accountId === from.id && entry.direction === "OUT" : entry.accountId === to.id && entry.direction === "IN"));
        if (!matches) throw new CashError("İstek anahtarı farklı bir transfer için kullanılmış.", 409);
        return { replayed: true, transferId: ids.reference };
      }
      if (!from.isActive || !to.isActive) throw new CashError("Transfer için iki hesap da aktif olmalıdır.", 409);
      await assertCashAvailable(tx, from, amount);
      const common = { organizationId: member.organizationId, source: "MANUAL" as const, amount, description, reference: ids.reference, occurredAt: new Date() };
      await tx.financeTransaction.create({ data: { ...common, id: ids.out, accountId: from.id, branchId: from.branchId, direction: "OUT" } });
      await tx.financeTransaction.create({ data: { ...common, id: ids.in, accountId: to.id, branchId: to.branchId, direction: "IN" } });
      await writeAudit(tx, member, "finance.transfer.create", "FinanceTransaction", ids.out, from.branchId, { toAccountId: to.id, transferId: ids.reference });
      return { replayed: false, transferId: ids.reference };
    });
    let result;
    try { result = await execute(); }
    catch (error) {
      // A competing request may win primary-key insertion. Re-read after rollback.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      result = await execute();
    }
    return NextResponse.json({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Cash transfer failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Transfer tamamlanamadı. Aynı istek anahtarıyla tekrar deneyin." }, { status: 500 });
  }
});
