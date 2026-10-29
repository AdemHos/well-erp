import { mutationReplay, rememberMutation } from "@/lib/mutation-replay";
import { stockReplay } from "@/lib/stock-replay";
import { CashError } from "@/lib/cash-management";
import { branchPolicy } from "@/lib/settings-policy";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchScope, branchIdScope } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { getOrderBranchId as getActiveBranchId } from "@/lib/order-access";
import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";



function parseDecimal(value: unknown): Prisma.Decimal | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(String(value));

    if (!decimal.isFinite() || decimal.decimalPlaces() > 3 || decimal.abs().gt("99999999999.999")) {
      return null;
    }

    return decimal;
  } catch {
    return null;
  }
}



async function handleGET() {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    const branchId = await getActiveBranchId(
      membership.organizationId
    );

    if (!branchId) {
      return NextResponse.json({ stocks: [] });
    }

    const stocks = await prisma.branchStock.findMany({
      where: { AND: [{
        organizationId: membership.organizationId,
        branchId,
      }, branchScope(membership)] },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json({ stocks });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET_STOCK_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Stok bilgileri alınırken bir hata oluştu." },
      { status: 500 }
    );
  }
}

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Yetkisiz işlem." },
        { status: 401 }
      );
    }

    

    const body = await request.json().catch(() => null);

    const productId = body?.productId;
    const branchId = body?.branchId;

    if (
      typeof productId !== "string" ||
      !productId.trim() ||
      typeof branchId !== "string" ||
      !branchId.trim()
    ) {
      return NextResponse.json(
        { error: "Ürün ve şube zorunludur." },
        { status: 400 }
      );
    }

    const quantity = parseDecimal(body?.quantity);

    const criticalLevel =
      body?.criticalLevel === "" ||
      body?.criticalLevel == null
        ? new Prisma.Decimal(0)
        : parseDecimal(body.criticalLevel);

    if (!quantity || !quantity.gt(0)) {
      return NextResponse.json(
        { error: "Stok miktarı sıfırdan büyük olmalıdır." },
        { status: 400 }
      );
    }

    if (!criticalLevel || criticalLevel.lt(0)) {
      return NextResponse.json(
        { error: "Kritik stok seviyesi geçersiz." },
        { status: 400 }
      );
    }

    if (
      body?.note != null &&
      typeof body.note !== "string"
    ) {
      return NextResponse.json(
        { error: "Açıklama geçersiz." },
        { status: 400 }
      );
    }

    const note = body?.note?.trim() || null;

    const [product, branch] = await Promise.all([
      prisma.product.findFirst({
        where: {
          id: productId,
          organizationId: membership.organizationId,
          isActive: true,
        },
        select: { id: true },
      }),
      prisma.branch.findFirst({
        where: { AND: [{
          id: branchId,
          organizationId: membership.organizationId,
        }, branchIdScope(membership)] },
        select: { id: true },
      }),
    ]);

    if (!product) {
      return NextResponse.json(
        { error: "Ürün bulunamadı." },
        { status: 404 }
      );
    }

    if (!branch) {
      return NextResponse.json(
        { error: "Şube bulunamadı." },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const attempt = await mutationReplay(tx, membership.organizationId, "stock.receive", body.idempotencyKey, { productId, branchId, quantity: quantity.toString(), note, criticalLevel: body.criticalLevel ?? null });
      if (attempt.entityId) return stockReplay(tx, membership.organizationId, branchId, productId, attempt.entityId);
      const stock = await tx.branchStock.upsert({
        where: {
          branchId_productId: {
            branchId,
            productId,
          },
        },
        create: {
          organizationId: membership.organizationId,
          branchId,
          productId,
          quantity,
          criticalLevel: body?.criticalLevel === "" || body?.criticalLevel == null ? (await branchPolicy(tx, membership.organizationId, branchId)).defaultCriticalLevel : criticalLevel,
        },
        update: {
          ...(body?.criticalLevel === "" || body?.criticalLevel == null ? {} : { criticalLevel }),
          quantity: { increment: quantity },
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          organizationId: membership.organizationId,
          branchId,
          productId,
          type: "PURCHASE",
          quantity,
          note,
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await writeAudit(tx, membership, "stock.manual.change", "StockMovement", movement.id, branchId, { type: movement.type, quantity: quantity.toString(), productId });
      await rememberMutation(tx, membership, attempt, "stock.receive", "StockMovement", movement.id, branchId);
      return { stock, movement };
    });

    return NextResponse.json(
      {
        message: "Stok girişi başarıyla kaydedildi.",
        stock: result.stock,
        movement: result.movement,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("CREATE_STOCK_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Stok girişi yapılırken bir hata oluştu." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("stock.manage", handleGET);

export const POST = withPermission("stock.manage", handlePOST);

export const PATCH = withPermission("stock.manage", async (request: Request) => {
  try {
    const actor = (await getCurrentMembership({ required: true }))!;
    const body = await request.json().catch(() => null);
    const level = parseDecimal(body?.criticalLevel);
    if (typeof body?.branchId !== "string" || typeof body?.productId !== "string" || !level || level.lt(0)) throw new CashError("Ürün, şube ve geçerli kritik seviye gereklidir.");
    await prisma.$transaction(async tx => {
      const where = { organizationId: actor.organizationId, branchId: body.branchId, productId: body.productId, ...branchScope(actor) };
      const stock = await tx.branchStock.findFirst({ where, select: { id: true } });
      if (!stock) throw new CashError("Stok bulunamadı.", 404);
      const changed = await tx.branchStock.updateMany({ where, data: { criticalLevel: level } });
      if (changed.count !== 1) throw new CashError("Stok değişti; sayfayı yenileyin.", 409);
      await writeAudit(tx, actor, "stock.critical-level.update", "BranchStock", stock.id, body.branchId, { criticalLevel: level.toString() });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Kritik seviye kaydedilemedi." }, { status: 500 });
  }
});
