import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPermission } from "@/lib/rbac";
import { currentActor, jsonBody } from "@/lib/current-accounts-service";
import { onlyFields, text } from "@/lib/current-accounts";
import { CashError, serialCashTransaction } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";
import { expenseError } from "@/lib/expense-service";

export const runtime = "nodejs";
export const PATCH = withPermission("finance.manage", async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    const actor = await currentActor(), { id } = await context.params, body = await jsonBody(request);
    onlyFields(body, ["name", "isActive"]);
    if (!Object.keys(body).length) throw new CashError("Değiştirilecek alan gönderin.");
    const name = body.name === undefined ? undefined : text(body.name, "kategori adı", 100, true)!;
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new CashError("Geçersiz aktiflik.");
    const category = await serialCashTransaction(prisma, async tx => {
      const saved = await tx.financeCategory.findFirst({ where: { id, organizationId: actor.organizationId, direction: "OUT" } });
      if (!saved) throw new CashError("Gider kategorisi bulunamadı.", 404);
      const updated = await tx.financeCategory.update({ where: { id, organizationId: actor.organizationId }, data: { ...(name !== undefined ? { name } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive as boolean } : {}) } });
      await writeAudit(tx, actor, "finance.category.update", "FinanceCategory", id, undefined, { previousName: saved.name, name: updated.name, isActive: updated.isActive });
      return updated;
    });
    return NextResponse.json({ success: true, category });
  } catch (error) { return expenseError(error); }
});
