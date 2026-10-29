import { mutationReplay, rememberMutation } from "@/lib/mutation-replay";
import { CashError } from "@/lib/cash-management";
import { branchPolicy } from "@/lib/settings-policy";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchIdScope } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

class TransferError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "TransferError";
  }
}

async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    

    const body = await request.json().catch(() => null);

    const { productId, fromBranchId, toBranchId } =
      body ?? {};

    if (
      typeof productId !== "string" ||
      !productId.trim() ||
      typeof fromBranchId !== "string" ||
      !fromBranchId.trim() ||
      typeof toBranchId !== "string" ||
      !toBranchId.trim()
    ) {
      throw new TransferError(
        "Ürün, kaynak şube ve hedef şube zorunludur.",
        400
      );
    }

    if (fromBranchId === toBranchId) {
      throw new TransferError(
        "Kaynak ve hedef şube aynı olamaz.",
        400
      );
    }

    if (
      !["string", "number"].includes(
        typeof body?.quantity
      ) ||
      String(body.quantity).trim() === ""
    ) {
      throw new TransferError(
        "Geçerli bir transfer miktarı giriniz.",
        400
      );
    }

    let quantity: Prisma.Decimal;

    try {
      quantity = new Prisma.Decimal(
        String(body.quantity)
      );

      if (
        !quantity.isFinite() ||
        !quantity.gt(0) ||
        quantity.decimalPlaces() > 3 ||
        quantity.gt("99999999999.999")
      ) {
        throw new Error("INVALID_QUANTITY");
      }
    } catch {
      throw new TransferError(
        "Transfer miktarı geçersiz.",
        400
      );
    }

    if (
      body?.note != null &&
      typeof body.note !== "string"
    ) {
      throw new TransferError(
        "Transfer açıklaması geçersiz.",
        400
      );
    }

    const note = body?.note?.trim() || null;
    const organizationId = membership.organizationId;

    const [product, branches] = await Promise.all([
      prisma.product.findFirst({
        where: {
          id: productId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.branch.findMany({
        where: { AND: [{
          organizationId,
          id: {
            in: [fromBranchId, toBranchId],
          },
        }, branchIdScope(membership)] },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (!product) {
      throw new TransferError(
        "Ürün bulunamadı veya satışa kapalı.",
        404
      );
    }

    if (branches.length !== 2) {
      throw new TransferError(
        "Kaynak veya hedef şube bulunamadı.",
        404
      );
    }

    const fromBranch = branches.find(
      (branch) => branch.id === fromBranchId
    )!;

    const toBranch = branches.find(
      (branch) => branch.id === toBranchId
    )!;

    const reference = `TRF-${crypto.randomUUID()}`;

    const result = await prisma.$transaction(
      async (tx) => {
        const attempt = await mutationReplay(tx, organizationId, "stock.transfer.request", body.idempotencyKey, { productId, fromBranchId, toBranchId, quantity: quantity.toString(), note });
        if (attempt.entityId) {
          const movement = await tx.stockMovement.findFirstOrThrow({ where: { id: attempt.entityId, organizationId, branchId: fromBranchId, productId, type: "TRANSFER_OUT" } });
          const source = await tx.branchStock.findFirstOrThrow({ where: { organizationId, branchId: fromBranchId, productId } });
          const destination = await tx.branchStock.findFirstOrThrow({ where: { organizationId, branchId: toBranchId, productId } });
          return { reference: movement.reference, product: product.name, fromBranch: fromBranch.name, toBranch: toBranch.name, quantity: movement.quantity.toString(), sourceQuantity: source.quantity.toString(), destinationQuantity: destination.quantity.toString() };
        }
        // Yeterli stok varsa atomik olarak azalt.
        const deducted = await tx.branchStock.updateMany({
          where: {
            organizationId,
            branchId: fromBranchId,
            productId,
            quantity: {
              gte: quantity,
            },
          },
          data: {
            quantity: {
              decrement: quantity,
            },
          },
        });

        if (deducted.count !== 1) {
          throw new TransferError(
            `${fromBranch.name} şubesinde yeterli stok bulunmuyor.`,
            409
          );
        }

        // Hedef şubede stok yoksa oluştur.
        await tx.branchStock.upsert({
          where: {
            branchId_productId: {
              branchId: toBranchId,
              productId,
            },
          },
          create: {
            organizationId,
            branchId: toBranchId,
            productId,
            quantity,
            criticalLevel: (await branchPolicy(tx, organizationId, toBranchId)).defaultCriticalLevel,
          },
          update: {
            quantity: {
              increment: quantity,
            },
          },
        });

        // Kaynak şubenin çıkış hareketi.
        const outgoing = await tx.stockMovement.create({
          data: {
            organizationId,
            branchId: fromBranchId,
            productId,
            type: "TRANSFER_OUT",
            quantity,
            reference,
            note: note
              ? `${toBranch.name} şubesine transfer. ${note}`
              : `${toBranch.name} şubesine transfer.`,
          },
        });

        // Hedef şubenin giriş hareketi.
        await tx.stockMovement.create({
          data: {
            organizationId,
            branchId: toBranchId,
            productId,
            type: "TRANSFER_IN",
            quantity,
            reference,
            note: note
              ? `${fromBranch.name} şubesinden transfer. ${note}`
              : `${fromBranch.name} şubesinden transfer.`,
          },
        });

        const [sourceStock, destinationStock] =
          await Promise.all([
            tx.branchStock.findUniqueOrThrow({
              where: {
                branchId_productId: {
                  branchId: fromBranchId,
                  productId,
                },
              },
            }),
            tx.branchStock.findUniqueOrThrow({
              where: {
                branchId_productId: {
                  branchId: toBranchId,
                  productId,
                },
              },
            }),
          ]);

        await writeAudit(tx, membership, "stock.transfer", "StockMovement", reference, fromBranchId, { toBranchId, productId, quantity: quantity.toString() });
        await rememberMutation(tx, membership, attempt, "stock.transfer.request", "StockMovement", outgoing.id, fromBranchId);
        return {
          reference,
          product: product.name,
          fromBranch: fromBranch.name,
          toBranch: toBranch.name,
          quantity: quantity.toString(),
          sourceQuantity: sourceStock.quantity.toString(),
          destinationQuantity:
            destinationStock.quantity.toString(),
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );

    return NextResponse.json(
      {
        success: true,
        message: "Stok transferi başarıyla tamamlandı.",
        transfer: result,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TransferError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("STOCK_TRANSFER_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Stok transferi gerçekleştirilemedi." },
      { status: 500 }
    );
  }
}

export const POST = withPermission("stock.manage", handlePOST);
