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



const ALLOWED_TYPES = [
  "WASTE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
] as const;

type ManualType = (typeof ALLOWED_TYPES)[number];

class InsufficientStockError extends Error {
  constructor() {
    super("Yetersiz stok veya stok kaydı bulunamadı.");
    this.name = "InsufficientStockError";
  }
}

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
      return NextResponse.json({ movements: [] });
    }

    const movements = await prisma.stockMovement.findMany({
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
        createdAt: "desc",
      },
      take: 100,
    });

    return NextResponse.json({ movements });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET_STOCK_MOVEMENTS_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Stok hareketleri alınırken bir hata oluştu." },
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
    const type = body?.type;

    if (
      typeof type !== "string" ||
      !ALLOWED_TYPES.includes(type as ManualType)
    ) {
      return NextResponse.json(
        { error: "Geçersiz stok işlemi." },
        { status: 400 }
      );
    }

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

    if (!quantity || !quantity.gt(0)) {
      return NextResponse.json(
        { error: "İşlem miktarı sıfırdan büyük olmalıdır." },
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

    const isIncoming = type === "ADJUSTMENT_IN";

    const result = await prisma.$transaction(async (tx) => {
      const attempt = await mutationReplay(tx, membership.organizationId, "stock.adjust", body.idempotencyKey, { productId, branchId, quantity: quantity.toString(), note, type });
      if (attempt.entityId) return stockReplay(tx, membership.organizationId, branchId, productId, attempt.entityId);
      if (isIncoming) {
        await tx.branchStock.upsert({
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
            criticalLevel: (await branchPolicy(tx, membership.organizationId, branchId)).defaultCriticalLevel,
          },
          update: {
            quantity: { increment: quantity },
          },
        });
      } else {
        // Tek atomik sorguda miktarı kontrol et ve azalt.
        const updated = await tx.branchStock.updateMany({
          where: { AND: [{
            organizationId: membership.organizationId,
            branchId,
            productId,
            quantity: { gte: quantity },
          }, branchScope(membership)] },
          data: {
            quantity: { decrement: quantity },
          },
        });

        if (updated.count !== 1) {
          throw new InsufficientStockError();
        }
      }

      const stock = await tx.branchStock.findUniqueOrThrow({
        where: { ...{
          branchId_productId: {
            branchId,
            productId,
          },
        }, AND: [branchScope(membership)] },
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
          type: type as ManualType,
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
      await rememberMutation(tx, membership, attempt, "stock.adjust", "StockMovement", movement.id, branchId);
      return { stock, movement };
    });

    return NextResponse.json(
      {
        message: "Stok işlemi başarıyla gerçekleştirildi.",
        stock: result.stock,
        movement: result.movement,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error("CREATE_STOCK_MOVEMENT_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Stok işlemi gerçekleştirilirken bir hata oluştu." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("stock.manage", handleGET);

export const POST = withPermission("stock.manage", handlePOST);
