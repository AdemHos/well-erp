import { branchPolicy, businessSnapshot, assertSalePolicy } from "@/lib/settings-policy";
import { legacyCustomerOmit, orderCustomerOmit } from "@/lib/customer-schema";
import { saleAccount, recordSaleFinance } from "@/lib/sale-finance";
import { mutationReplay, rememberMutation } from "@/lib/mutation-replay";
import { CashError } from "@/lib/cash-management";
import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchIdScope } from "@/lib/permissions";

import { NextResponse } from "next/server";
import { getOrderBranchId as getActiveBranchId, orderReceiptInclude } from "@/lib/order-access";
import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

// ======================================================
// TYPES
// ======================================================

type DiscountType = "PERCENT" | "FIXED";

type DiscountInput = {
  type: DiscountType | null;
  value: Prisma.Decimal;
};

// ======================================================
// CUSTOM ERRORS
// ======================================================

class InsufficientStockError extends Error {
  constructor(productName: string) {
    super(`${productName} için yeterli stok bulunmuyor.`);
    this.name = "InsufficientStockError";
  }
}



// ======================================================
// DECIMAL HELPERS
// ======================================================

function parseQuantity(value: unknown): Prisma.Decimal | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  try {
    const quantity = new Prisma.Decimal(String(value));

    if (
      !quantity.isFinite() ||
      !quantity.gt(0) ||
      quantity.decimalPlaces() > 3
    ) {
      return null;
    }

    return quantity;
  } catch {
    return null;
  }
}

function parseNonNegativeDecimal(
  value: unknown
): Prisma.Decimal | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(String(value));

    if (
      !decimal.isFinite() ||
      decimal.lt(0) ||
      decimal.decimalPlaces() > 2
    ) {
      return null;
    }

    return decimal;
  } catch {
    return null;
  }
}

function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP
  );
}

// ======================================================
// DISCOUNT VALIDATION
// ======================================================

function parseDiscount(
  value: unknown
):
  | { success: true; discount: DiscountInput }
  | { success: false; error: string } {
  if (value == null) {
    return {
      success: true,
      discount: {
        type: null,
        value: new Prisma.Decimal(0),
      },
    };
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {
      success: false,
      error: "İndirim bilgisi geçersiz.",
    };
  }

  const discount = value as Record<string, unknown>;

  const type = discount.type;
  const rawValue = discount.value;

  if (type !== "PERCENT" && type !== "FIXED") {
    return {
      success: false,
      error: "Geçerli bir indirim türü seçiniz.",
    };
  }

  const parsedValue = parseNonNegativeDecimal(rawValue);

  if (!parsedValue) {
    return {
      success: false,
      error: "İndirim değeri geçersiz.",
    };
  }

  if (
    type === "PERCENT" &&
    parsedValue.gt(100)
  ) {
    return {
      success: false,
      error: "Yüzdesel indirim %100'ü geçemez.",
    };
  }

  return {
    success: true,
    discount: {
      type,
      value: parsedValue,
    },
  };
}

function calculateDiscount(
  subtotal: Prisma.Decimal,
  discount: DiscountInput
):
  | {
      success: true;
      discountType: DiscountType | null;
      discountValue: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      total: Prisma.Decimal;
    }
  | { success: false; error: string } {
  const zero = new Prisma.Decimal(0);

  if (!discount.type || discount.value.eq(0)) {
    return {
      success: true,
      discountType: null,
      discountValue: zero,
      discountAmount: zero,
      total: subtotal,
    };
  }

  let discountAmount: Prisma.Decimal;

  if (discount.type === "PERCENT") {
    discountAmount = roundMoney(
      subtotal.mul(discount.value).div(100)
    );
  } else {
    discountAmount = discount.value;
  }

  if (discountAmount.gt(subtotal)) {
    return {
      success: false,
      error: "İndirim tutarı ara toplamı geçemez.",
    };
  }

  const total = roundMoney(
    subtotal.minus(discountAmount)
  );

  return {
    success: true,
    discountType: discount.type,
    discountValue: discount.value,
    discountAmount,
    total,
  };
}

// ======================================================
// GET /api/orders
// Aktif şubenin filtrelenmiş satış geçmişi
// ======================================================

async function handleGET(request: Request) {
  try {
    const membership = await getCurrentMembership();
    if (!membership) return NextResponse.json({ error: "Yetkisiz işlem." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const limit = Number(params.get("limit") ?? 25);
    const paymentMethod = params.get("paymentMethod");
    const status = params.get("status");
    const search = (params.get("search") ?? "").trim();
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit) || search.length > 200 ||
      (paymentMethod && paymentMethod !== "CASH" && paymentMethod !== "CARD") ||
      (status && status !== "COMPLETED" && status !== "CANCELLED" && status !== "REFUNDED")) {
      return NextResponse.json({ error: "Geçersiz satış filtresi veya sayfalama." }, { status: 400 });
    }
    const day = (value: string | null) => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_DATE");
      const date = new Date(value + "T00:00:00Z");
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_DATE");
      return new Date(value + "T00:00:00+03:00");
    };
    let start: Date | undefined;
    let end: Date | undefined;
    try { start = day(params.get("startDate")); end = day(params.get("endDate")); } catch {
      return NextResponse.json({ error: "Geçerli bir tarih aralığı seçin." }, { status: 400 });
    }
    if (start && end && start > end) return NextResponse.json({ error: "Başlangıç tarihi bitişten sonra olamaz." }, { status: 400 });
    const branchId = await getActiveBranchId(membership.organizationId);
    const where: Prisma.OrderWhereInput = {
      organizationId: membership.organizationId, branchId: branchId ?? "",
      ...(paymentMethod ? { paymentMethod: paymentMethod as "CASH" | "CARD" } : {}),
      ...(status ? { status: status as "COMPLETED" | "CANCELLED" | "REFUNDED" } : {}),
      ...(search ? { OR: [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { branch: { name: { contains: search, mode: "insensitive" } } },
        { items: { some: { productName: { contains: search, mode: "insensitive" } } } },
      ] } : {}),
      ...((start || end) ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: new Date(end.getTime() + 86400000) } : {}) } } : {}),
    };
    const [orders, total, groups] = await Promise.all([
      prisma.order.findMany({ where, omit: await orderCustomerOmit(prisma), include: orderReceiptInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.order.count({ where }),
      prisma.order.groupBy({ by: ["status", "paymentMethod"], where, _sum: { total: true }, _count: { id: true } }),
    ]);
    const completed = groups.filter((group) => group.status === "COMPLETED");
    const sum = (method?: "CASH" | "CARD") => completed.filter((group) => !method || group.paymentMethod === method).reduce((total, group) => total.plus(group._sum.total ?? 0), new Prisma.Decimal(0)).toString();
    return NextResponse.json({ orders, total, page, totalPages: Math.ceil(total / limit), branchId,
      summary: { count: completed.reduce((total, group) => total + group._count.id, 0), total: sum(), cash: sum("CASH"), card: sum("CARD") } });
  } catch {
    return NextResponse.json({ error: "Satışlar alınırken bir hata oluştu." }, { status: 500 });
  }
}

// ======================================================
// POST /api/orders
// POS satışı + indirim + otomatik stok düşümü
// ======================================================


async function handlePOST(request: Request) {
  try {
    const membership = await getCurrentMembership();
    if (!membership) return NextResponse.json({ error: "Yetkisiz işlem." }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CashError("Geçersiz satış bilgisi.");
    const { branchId, paymentMethod } = body;
    if (typeof branchId !== "string" || !branchId.trim()) throw new CashError("Şube seçimi zorunludur.");
    if (paymentMethod !== "CASH" && paymentMethod !== "CARD") throw new CashError("Geçerli bir ödeme yöntemi seçin.");
    if (body.financeAccountId !== undefined && (typeof body.financeAccountId !== "string" || !body.financeAccountId.trim() || body.financeAccountId.length > 200)) throw new CashError("Geçersiz finans hesabı.");
    if (body.customerSnapshot !== undefined || (body.customerId != null && (typeof body.customerId !== "string" || !body.customerId.trim() || body.customerId.length > 200))) throw new CashError("Geçersiz müşteri seçimi.");
    if (body.note != null && (typeof body.note !== "string" || body.note.length > 500)) throw new CashError("Açıklama en fazla 500 karakter olmalıdır.");
    const customerId: string | null = body.customerId?.trim() || null;
    const financeAccountId: string | undefined = body.financeAccountId?.trim();
    const note: string | null = body.note?.trim() || null;
    if (branchId !== await getActiveBranchId(membership.organizationId)) throw new CashError("Satış şubesi aktif şubeyle eşleşmiyor. Sayfayı yenileyin.");
    if (!await prisma.branch.findFirst({ where: { AND: [{ id: branchId, organizationId: membership.organizationId }, branchIdScope(membership)] }, select: { id: true } })) throw new CashError("Şube bulunamadı.", 404);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 250) throw new CashError("Sepet 1–250 kalem içermelidir.");
    const cart = new Map<string, Prisma.Decimal>();
    for (const item of body.items) {
      const quantity = parseQuantity(item?.quantity);
      if (typeof item?.productId !== "string" || !item.productId.trim() || item.productId.length > 200 || !quantity) throw new CashError("Geçersiz ürün veya miktar.");
      const combined = (cart.get(item.productId) ?? new Prisma.Decimal(0)).plus(quantity);
      if (combined.gt("999999999.999")) throw new CashError("Ürün miktarı sınırı aşıldı.");
      cart.set(item.productId, combined);
    }
    const parsed = parseDiscount(body.discount);
    if (!parsed.success) throw new CashError(parsed.error);
    const payload = { branchId, paymentMethod, customerId, financeAccountId: financeAccountId ?? null, note,
      items: [...cart].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity: quantity.toString() })),
      discount: { type: parsed.discount.type, value: parsed.discount.value.toString() } };
    const result = await prisma.$transaction(async tx => {
      const attempt = await mutationReplay(tx, membership.organizationId, "orders.sale.request", body.idempotencyKey, payload);
      if (attempt.entityId) {
        const order = await tx.order.findFirst({ where: { id: attempt.entityId, organizationId: membership.organizationId, branchId }, omit: await orderCustomerOmit(tx), include: orderReceiptInclude });
        if (!order) throw new CashError("Önceki satış kaydı doğrulanamadı.", 409);
        return { order, replayed: true };
      }
      const products = await tx.product.findMany({ where: { organizationId: membership.organizationId, id: { in: [...cart.keys()] }, isActive: true, isSellable: true }, select: { id: true, name: true, price: true } });
      if (products.length !== cart.size) throw new CashError("Sepette bulunamayan veya satışa kapalı bir ürün var.");
      const orderItems = products.map(product => { const quantity = cart.get(product.id)!; return { productId: product.id, productName: product.name, quantity, unitPrice: product.price, total: roundMoney(product.price.mul(quantity)) }; });
      const subtotal = roundMoney(orderItems.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0)));
      const calculated = calculateDiscount(subtotal, parsed.discount);
      if (!calculated.success) throw new CashError(calculated.error);
      if (calculated.total.gt("9999999999.99") || subtotal.gt("9999999999.99")) throw new CashError("Satış toplamı sınırı aşıldı.");
      const policy = await branchPolicy(tx, membership.organizationId, branchId, true);
      assertSalePolicy(policy, membership.role, subtotal, calculated.discountAmount, customerId, calculated.discountType === "PERCENT" ? calculated.discountValue : undefined);
      const snapshot = await businessSnapshot(tx, membership.organizationId);
      if (customerId) await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId} AND "organizationId"=${membership.organizationId} FOR SHARE`;
      const customer = customerId ? await tx.customer.findFirst({ where: { id: customerId, organizationId: membership.organizationId, isActive: true }, select: { id: true, name: true, code: true, type: true } }) : null;
      if (customerId && !customer) throw new CashError("Aktif müşteri bulunamadı.", 409);
      const accountId = calculated.total.gt(0) ? await saleAccount(tx, membership.organizationId, branchId, paymentMethod, financeAccountId) : null;
      const sortedItems = [...orderItems].sort((a, b) => a.productId.localeCompare(b.productId));
      for (const item of sortedItems) {
        if (policy.allowNegativeStock) {
          const stock = await tx.branchStock.upsert({ where: { branchId_productId: { branchId, productId: item.productId } }, create: { organizationId: membership.organizationId, branchId, productId: item.productId, quantity: item.quantity.negated(), criticalLevel: policy.defaultCriticalLevel }, update: { quantity: { decrement: item.quantity } } });
          if (stock.organizationId !== membership.organizationId) throw new CashError("Stok işletmesi eşleşmiyor.", 409);
        } else {
          const updated = await tx.branchStock.updateMany({ where: { AND: [{ organizationId: membership.organizationId, branchId, productId: item.productId, quantity: { gte: item.quantity } }] }, data: { quantity: { decrement: item.quantity } } });
          if (updated.count !== 1) throw new InsufficientStockError(item.productName);
        }
      }
      const customerSnapshot = customer ? { name: customer.name, code: customer.code, type: customer.type } : null;
      const order = await tx.order.create({ omit: legacyCustomerOmit, data: {
        organizationId: membership.organizationId, branchId, orderNumber: "POS-" + crypto.randomUUID(), status: "COMPLETED", paymentMethod,
        subtotal, discountType: calculated.discountType, discountValue: calculated.discountValue, discountAmount: calculated.discountAmount, total: calculated.total, note,
        ...(snapshot ? { businessSnapshot: snapshot } : {}), ...(customer ? { customerId: customer.id, customerSnapshot: customerSnapshot! } : {}), items: { create: orderItems },
      }, include: orderReceiptInclude });
      for (const item of sortedItems) await tx.stockMovement.create({ data: { organizationId: membership.organizationId, branchId, productId: item.productId, type: "SALE", quantity: item.quantity, reference: order.orderNumber, note: "POS satışı: " + order.orderNumber } });
      if (accountId) await recordSaleFinance(tx, order, accountId);
      await writeAudit(tx, membership, "orders.sale", "Order", order.id, branchId, { total: order.total.toString(), orderNumber: order.orderNumber });
      await rememberMutation(tx, membership, attempt, "orders.sale.request", "Order", order.id, branchId);
      return { order: { ...order, ...(snapshot ? { businessSnapshot: snapshot } : {}), ...(customer ? { customerId: customer.id, customerSnapshot } : {}) }, replayed: false };
    }, { maxWait: 5000, timeout: 15000 });
    return NextResponse.json({ message: "Satış başarıyla tamamlandı.", ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InsufficientStockError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) return NextResponse.json({ error: "Veritabanı güncellemesi bekleniyor.", code: "SCHEMA_PENDING" }, { status: 503 });
    console.error("CREATE_ORDER_ERROR", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Satış sonucu doğrulanamadı. Aynı istek anahtarıyla tekrar deneyin." }, { status: 500 });
  }
}
export const GET = withPermission("orders.read", handleGET);
export const POST = withPermission("pos.sell", handlePOST);
