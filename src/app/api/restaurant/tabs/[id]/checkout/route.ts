import { saleAccount, recordSaleFinance } from "@/lib/sale-finance";
import { CashError } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";
import { branchPolicy, businessSnapshot } from "@/lib/settings-policy";
import { legacyCustomerOmit } from "@/lib/customer-schema";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CheckoutMethod = "CASH" | "CARD";

class CheckoutError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

async function handlePOST(request: NextRequest, { params }: RouteContext) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 },
      );
    }

    

    

    const { id: tabId } = await params;

    const body = await request.json().catch(() => null);
    const paymentMethod: unknown = body?.paymentMethod;

    if (paymentMethod !== "CASH" && paymentMethod !== "CARD") {
      return NextResponse.json(
        { error: "Geçersiz ödeme yöntemi." },
        { status: 400 },
      );
    }

    if (body.financeAccountId !== undefined && (typeof body.financeAccountId !== "string" || !body.financeAccountId.trim() || body.financeAccountId.length > 200)) throw new CheckoutError("Geçersiz finans hesabı.", 400);
    const method = paymentMethod as CheckoutMethod;

    const result = await prisma.$transaction(
      async (tx) => {
        // Aynı adisyonun eşzamanlı kapatılmasını engelle.
        const lockedTabs = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "Tab"
          WHERE id = ${tabId}
            AND "organizationId" = ${membership.organizationId}
          FOR UPDATE
        `;

        if (lockedTabs.length === 0) {
          throw new CheckoutError("Adisyon bulunamadı.", 404);
        }

        const tab = await tx.tab.findFirst({
          where: { AND: [{
            id: tabId,
            organizationId: membership.organizationId,
          }, branchScope(membership)] },
          include: {
            items: true,
          },
        });

        if (!tab) {
          throw new CheckoutError("Adisyon bulunamadı.", 404);
        }

        if (tab.status === "CLOSED" && tab.orderId) {
          const saved = await tx.order.findFirst({ where: { id: tab.orderId, organizationId: membership.organizationId, branchId: tab.branchId }, select: { id: true, orderNumber: true, total: true, paymentMethod: true, financeTransactions: { where: { source: "POS_SALE" }, select: { accountId: true } } } });
          if (!saved || saved.paymentMethod !== method || saved.financeTransactions.length !== 1 || (body.financeAccountId && saved.financeTransactions[0].accountId !== body.financeAccountId)) throw new CheckoutError("Önceki ödeme seçilen yöntem/hesapla eşleşmiyor.", 409);
          return { orderId: saved.id, orderNumber: saved.orderNumber, tabId: tab.id, total: saved.total.toString(), paymentMethod: method, replayed: true };
        }
        if (tab.status !== "OPEN" || tab.orderId) {
          throw new CheckoutError("Bu adisyon daha önce kapatılmış.", 409);
        }

        if (tab.items.length === 0) {
          throw new CheckoutError("Boş adisyon için ödeme alınamaz.", 400);
        }

        const subtotal = tab.items.reduce(
          (sum, item) => sum.plus(item.total),
          new Prisma.Decimal(0),
        );

        if (subtotal.lte(0)) {
          throw new CheckoutError(
            "Adisyon toplamı sıfırdan büyük olmalıdır.",
            400,
          );
        }

        const snapshot = await businessSnapshot(tx, tab.organizationId);
        const policy = await branchPolicy(tx, tab.organizationId, tab.branchId, true);
        const accountId = await saleAccount(tx, tab.organizationId, tab.branchId, method, body.financeAccountId?.trim());
        // Aynı ürüne ait adisyon kalemlerini birleştir.
        const stockMap = new Map<
          string,
          {
            productName: string;
            quantity: Prisma.Decimal;
          }
        >();

        for (const item of tab.items) {
          // Stok takibi için ürün kimliği zorunlu.
          if (!item.productId) {
            throw new CheckoutError(
              `${item.productName} için ürün bağlantısı bulunamadı.`,
              400,
            );
          }

          const productId = item.productId;
          const quantity = new Prisma.Decimal(item.quantity);

          if (!quantity.isFinite() || quantity.lte(0)) {
            throw new CheckoutError(
              "Adisyonda geçersiz ürün miktarı var.",
              400,
            );
          }

          const existing = stockMap.get(productId);

          if (existing) {
            existing.quantity = existing.quantity.plus(quantity);
          } else {
            stockMap.set(productId, {
              productName: item.productName,
              quantity,
            });
          }
        }

        // Ürünleri sabit sırada işleyerek kilit
        // çakışması riskini azalt.
        const stockItems = Array.from(stockMap.entries()).sort(([a], [b]) =>
          a.localeCompare(b),
        );

        // Stokları atomik olarak azalt.
        for (const [productId, item] of stockItems) {
          if (policy.allowNegativeStock) {
            const stock = await tx.branchStock.upsert({ where: { branchId_productId: { branchId: tab.branchId, productId } }, create: { organizationId: tab.organizationId, branchId: tab.branchId, productId, quantity: item.quantity.negated(), criticalLevel: policy.defaultCriticalLevel }, update: { quantity: { decrement: item.quantity } } });
            if (stock.organizationId !== tab.organizationId) throw new CheckoutError("Stok işletmesi eşleşmiyor.", 409);
            continue;
          }
          const updated = await tx.branchStock.updateMany({
            where: { AND: [{
              organizationId: tab.organizationId,
              branchId: tab.branchId,
              productId,
              quantity: {
                gte: item.quantity,
              },
            }, branchScope(membership)] },
            data: {
              quantity: {
                decrement: item.quantity,
              },
            },
          });

          if (updated.count !== 1) {
            throw new CheckoutError(
              `${item.productName} için yeterli stok bulunmuyor.`,
              409,
            );
          }
        }

        const orderNumber = `REST-${crypto.randomUUID()}`;

        // Satışı oluştur.
        const order = await tx.order.create({
          omit: legacyCustomerOmit,
          data: {
            ...(snapshot ? { businessSnapshot: snapshot } : {}),
            orderNumber,
            organizationId: tab.organizationId,
            branchId: tab.branchId,
            status: "COMPLETED",
            paymentMethod: method,
            subtotal,
            total: subtotal,
            note: `Restoran adisyonu: ${tab.tabNumber}`,
            items: {
              create: tab.items.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
              })),
            },
          },
        });

        // Her satılan ürün için stok hareketi oluştur.
        for (const [productId, item] of stockItems) {
          await tx.stockMovement.create({
            data: {
              organizationId: tab.organizationId,
              branchId: tab.branchId,
              productId,
              type: "SALE",
              quantity: item.quantity,
              reference: order.orderNumber,
              note: `Restoran satışı: ${tab.tabNumber}`,
            },
          });
        }

        await recordSaleFinance(tx, order, accountId);
        await writeAudit(tx, membership, "restaurant.checkout", "Order", order.id, tab.branchId, { tabId: tab.id, total: order.total.toString() });

        // Adisyonu kapat ve satışa bağla.
        const closedTab = await tx.tab.update({
          where: { ...{
            id: tab.id,
          }, AND: [branchScope(membership)] },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            subtotal,
            total: subtotal,
            orderId: order.id,
          },
        });

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          tabId: closedTab.id,
          total: subtotal.toString(),
          paymentMethod: method,
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
      },
    );

    return NextResponse.json({
      success: true,
      message: "Ödeme kaydedildi. Adisyon kapatıldı.",
      ...result,
    });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error("RESTAURANT_CHECKOUT_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Ödeme tamamlanamadı." },
      { status: 500 },
    );
  }
}

export const POST = withPermission("restaurant.checkout", handlePOST, "tab");
