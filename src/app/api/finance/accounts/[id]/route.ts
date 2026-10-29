import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchScope } from "@/lib/permissions";
import { withPermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { CashError, cashAmount, serialCashTransaction } from "@/lib/cash-management";

export const runtime = "nodejs";
export const PATCH = withPermission("finance.manage", async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    const member = await getCurrentMembership();
    if (!member) return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CashError("Geçersiz istek.");
    if (Object.keys(body).some(key => !["name", "type", "openingBalance", "isActive"].includes(key))) throw new CashError("Şube ve diğer hesap alanları değiştirilemez.");
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)) throw new CashError("Geçerli bir hesap adı girin.");
    if (body.type !== undefined && !["CASH", "CARD", "BANK"].includes(body.type)) throw new CashError("Geçersiz hesap türü.");
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new CashError("Geçersiz aktiflik değeri.");
    const opening = body.openingBalance === undefined ? undefined : cashAmount(body.openingBalance, true);
    const account = await serialCashTransaction(prisma, async tx => {
      const saved = await tx.financeAccount.findFirst({ where: { AND: [{ id, organizationId: member.organizationId }, branchScope(member)] } });
      if (!saved) throw new CashError("Hesap bulunamadı.", 404);
      const financialChange = (body.type !== undefined && body.type !== saved.type) || (opening !== undefined && !opening.eq(saved.openingBalance));
      if (financialChange && await tx.financeTransaction.count({ where: { accountId: id } })) throw new CashError("Hareketi olan hesabın türü ve açılış bakiyesi değiştirilemez.", 409);
      const updated = await tx.financeAccount.update({ where: { id }, data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(opening !== undefined ? { openingBalance: opening } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      } });
      await writeAudit(tx, member, "finance.account.update", "FinanceAccount", id, saved.branchId);
      return updated;
    });
    return NextResponse.json({ success: true, account });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Bu şubede aynı isimde hesap var." }, { status: 409 });
    console.error("Cash account update failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Hesap güncellenemedi." }, { status: 500 });
  }
});
