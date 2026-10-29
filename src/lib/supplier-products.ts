import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cashAmount, CashError, serialCashTransaction } from "@/lib/cash-management";
import { jsonBody } from "@/lib/current-accounts-service";
import { onlyFields, text } from "@/lib/current-accounts";
import { supplierActor, supplierError, supplierRecord } from "@/lib/supplier-service";
import { supplierVersion } from "@/lib/suppliers";
import { hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

type Context = { params: Promise<{ id: string; productId?: string }> };
export async function saveSupplierProduct(request: NextRequest, context: Context) {
  try {
    const actor = await supplierActor("suppliers.manage"), { id, productId: pathId } = await context.params;
    const body = await jsonBody(request), updating = request.method === "PATCH";
    onlyFields(body, updating ? ["supplierProductCode", "lastPurchasePrice", "expectedVersion"] : ["productId", "supplierProductCode", "lastPurchasePrice"]);
    const productId = pathId ?? text(body.productId, "ürün", 200, true)!;
    const canFinance = hasPermission(actor.role, "finance.manage");
    if (body.lastPurchasePrice !== undefined && !canFinance) throw new CashError("Fiyat için finans yetkisi gerekiyor.", 403);
    const price = body.lastPurchasePrice === "" || body.lastPurchasePrice === null ? null : body.lastPurchasePrice === undefined ? undefined : cashAmount(body.lastPurchasePrice, true);
    if (price?.gt("9999999999.99")) throw new CashError("Alış fiyatı izin verilen sınırı aşıyor.");
    const code = text(body.supplierProductCode, "tedarikçi ürün kodu", 100);
    const version = updating ? supplierVersion(body.expectedVersion) : undefined;
    const product = await serialCashTransaction(prisma, async tx => {
      const supplier = await supplierRecord(tx, actor, id);
      if (!supplier.isActive) throw new CashError("Pasif tedarikçiye ürün bağlanamaz veya ilişkisi düzenlenemez.", 409);
      if (!await tx.product.findFirst({ where: { id: productId, organizationId: actor.organizationId, ...(updating ? {} : { isActive: true }) }, select: { id: true } })) throw new CashError("Bu işletmede uygun ürün bulunamadı.", 404);
      const where = { organizationId_supplierId_productId: { organizationId: actor.organizationId, supplierId: id, productId } };
      const saved = await tx.supplierProduct.findUnique({ where });
      if (updating && (!saved || saved.version !== version)) throw new CashError("İlişki değişmiş veya bulunamadı. Yenileyin.", 409);
      if (!updating && saved) throw new CashError("Bu ürün zaten tedarikçiye bağlı.", 409);
      const data = { ...(body.supplierProductCode !== undefined ? { supplierProductCode: code } : {}), ...(price !== undefined ? { lastPurchasePrice: price } : {}) };
      const result = updating ? await tx.supplierProduct.update({ where: { id: saved!.id, organizationId: actor.organizationId, version }, data: { ...data, version: { increment: 1 } } }) : await tx.supplierProduct.create({ data: { ...data, organizationId: actor.organizationId, supplierId: id, productId } });
      await writeAudit(tx, actor, updating ? "supplier.product.update" : "supplier.product.link", "SupplierProduct", result.id, undefined, { supplierId: id, productId });
      return { id: result.id, productId, supplierProductCode: result.supplierProductCode, version: result.version, ...(canFinance ? { lastPurchasePrice: result.lastPurchasePrice } : {}) };
    });
    return NextResponse.json({ product }, { status: updating ? 200 : 201 });
  } catch (error) { return supplierError(error); }
}
export async function removeSupplierProduct(request: NextRequest, context: Context) {
  try {
    const actor = await supplierActor("suppliers.manage"), { id, productId } = await context.params;
    const body = await jsonBody(request); onlyFields(body, ["expectedVersion"]);
    const version = supplierVersion(body.expectedVersion);
    await serialCashTransaction(prisma, async tx => {
      await supplierRecord(tx, actor, id);
      const saved = await tx.supplierProduct.findFirst({ where: { organizationId: actor.organizationId, supplierId: id, productId } });
      if (!saved || saved.version !== version) throw new CashError("İlişki değişmiş veya bulunamadı. Yenileyin.", 409);
      await tx.supplierProduct.delete({ where: { id: saved.id, organizationId: actor.organizationId, version } });
      await writeAudit(tx, actor, "supplier.product.unlink", "SupplierProduct", saved.id, undefined, { supplierId: id, productId });
    });
    return NextResponse.json({ success: true });
  } catch (error) { return supplierError(error); }
}
