import { mutationReplay, rememberMutation } from "@/lib/mutation-replay";
import { writeAudit } from "@/lib/audit";
import { assertCashAvailable, CashError, serialCashTransaction } from "@/lib/cash-management";
import { withPermission } from "@/lib/rbac";
import { branchScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import {
  Prisma,
  FinanceDirection,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ======================================================
// HELPERS
// ======================================================

function isDirection(
  value: unknown
): value is FinanceDirection {
  return (
    value === FinanceDirection.IN ||
    value === FinanceDirection.OUT
  );
}

function parseAmount(value: unknown): Prisma.Decimal | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  try {
    const amount = new Prisma.Decimal(value);

    if (
      !amount.isFinite() ||
      amount.lte(0) ||
      amount.decimalPlaces() > 2 ||
      amount.gt("999999999999.99")
    ) {
      return null;
    }

    return amount;
  } catch {
    return null;
  }
}

function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const calendar = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value) return null;
    // Dashboard date filters cover the whole business day in Europe/Istanbul.
    return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

// ======================================================
// GET /api/finance/transactions
// List finance transactions
// ======================================================

async function handleGET(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    const params = request.nextUrl.searchParams;

    const branchId = params.get("branchId");
    const accountId = params.get("accountId");
    const direction = params.get("direction");
    const startDate = params.get("startDate");
    const endDate = params.get("endDate");

    // Validate direction
    if (direction && !isDirection(direction)) {
      return NextResponse.json(
        { error: "Geçersiz işlem yönü." },
        { status: 400 }
      );
    }

    // Validate dates
    const start = parseDate(startDate);
    const end = parseDate(endDate, true);

    if ((startDate && !start) || (endDate && !end)) {
      return NextResponse.json(
        { error: "Geçersiz tarih filtresi." },
        { status: 400 }
      );
    }

    if (start && end && start > end) {
      return NextResponse.json(
        {
          error:
            "Başlangıç tarihi bitiş tarihinden sonra olamaz.",
        },
        { status: 400 }
      );
    }

    // Pagination
    const pageParam = params.get("page") ?? "1";
    const limitParam = params.get("limit") ?? "20";

    const page = Number(pageParam);
    const limit = Number(limitParam);

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (page - 1) * limit > Number.MAX_SAFE_INTEGER
    ) {
      return NextResponse.json(
        { error: "Geçersiz sayfalama parametreleri." },
        { status: 400 }
      );
    }

    // ==================================================
    // BUILD FILTERS
    // ==================================================

    const where: Prisma.FinanceTransactionWhereInput = {
      organizationId: membership.organizationId,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    if (accountId) {
      where.accountId = accountId;
    }

    // TypeScript now recognizes FinanceDirection enum
    if (direction && isDirection(direction)) {
      where.direction = direction;
    }

    if (start || end) {
      where.occurredAt = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
      };
    }

    // ==================================================
    // FETCH TRANSACTIONS
    // ==================================================

    const [transactions, total, summary] = await Promise.all([
      prisma.financeTransaction.findMany({
        where: { AND: [where, branchScope(membership)] },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
          account: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              direction: true,
            },
          },
          order: {
            select: {
              id: true,
              orderNumber: true,
            },
          },
        },
        orderBy: [
          { occurredAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),

      prisma.financeTransaction.count({
        where: { AND: [where, branchScope(membership)] },
      }),

      prisma.financeTransaction.groupBy({
        by: ["direction"],
        where: { AND: [where, branchScope(membership)] },
        _sum: {
          amount: true,
        },
      }),
    ]);

    // ==================================================
    // CALCULATE SUMMARY
    // ==================================================

    const incoming =
      summary.find(
        (item) => item.direction === FinanceDirection.IN
      )?._sum.amount ?? new Prisma.Decimal(0);

    const outgoing =
      summary.find(
        (item) => item.direction === FinanceDirection.OUT
      )?._sum.amount ?? new Prisma.Decimal(0);

    const net = incoming.minus(outgoing);

    return NextResponse.json({
      success: true,

      transactions: transactions.map((transaction) => ({
        ...transaction,
        amount: transaction.amount.toString(),
      })),

      summary: {
        incoming: incoming.toString(),
        outgoing: outgoing.toString(),
        net: net.toString(),
      },

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Finance transactions GET error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Finans hareketleri getirilemedi.",
      },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/finance/transactions
// Create manual income or expense
// ======================================================

async function handlePOST(request: NextRequest) {
  try {
    // ==================================================
    // AUTHENTICATION
    // ==================================================

    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    // ==================================================
    // AUTHORIZATION
    // ==================================================

    

    

    // ==================================================
    // PARSE BODY
    // ==================================================

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Geçerli bir JSON gövdesi gönderin." },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Geçersiz istek verisi." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    const {
      accountId,
      categoryId,
      direction,
      amount,
      description,
      reference,
      occurredAt,
    } = data;

    // ==================================================
    // VALIDATION
    // ==================================================

    if (
      typeof accountId !== "string" ||
      !accountId.trim() ||
      !isDirection(direction)
    ) {
      return NextResponse.json(
        {
          error:
            "Finans hesabı ve işlem yönü zorunludur.",
        },
        { status: 400 }
      );
    }

    const parsedAmount = parseAmount(amount);

    if (!parsedAmount) {
      return NextResponse.json(
        {
          error:
            "Geçerli ve pozitif bir işlem tutarı girin.",
        },
        { status: 400 }
      );
    }

    if (
      categoryId != null &&
      (typeof categoryId !== "string" ||
        !categoryId.trim())
    ) {
      return NextResponse.json(
        { error: "Geçersiz kategori." },
        { status: 400 }
      );
    }

    if (
      description != null &&
      (typeof description !== "string" ||
        description.length > 500)
    ) {
      return NextResponse.json(
        {
          error: "Açıklama en fazla 500 karakter olabilir.",
        },
        { status: 400 }
      );
    }

    if (
      reference != null &&
      (typeof reference !== "string" ||
        reference.length > 100)
    ) {
      return NextResponse.json(
        {
          error: "Referans en fazla 100 karakter olabilir.",
        },
        { status: 400 }
      );
    }

    if (
      occurredAt != null &&
      typeof occurredAt !== "string"
    ) {
      return NextResponse.json(
        { error: "Geçersiz işlem tarihi." },
        { status: 400 }
      );
    }

    const transactionDate =
      occurredAt != null
        ? parseDate(occurredAt)
        : new Date();

    if (!transactionDate) {
      return NextResponse.json(
        { error: "Geçersiz işlem tarihi." },
        { status: 400 }
      );
    }

    // ==================================================
    // VERIFY ACCOUNT
    // ==================================================

    const organizationId = membership.organizationId;

    const account = await prisma.financeAccount.findFirst({
      where: { AND: [{
        id: accountId,
        organizationId,
        isActive: true,
      }, branchScope(membership)] },
      select: {
        id: true,
        branchId: true,
        name: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        {
          error: "Aktif finans hesabı bulunamadı.",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // VERIFY CATEGORY
    // ==================================================

    if (categoryId) {
      const category = await prisma.financeCategory.findFirst({
        where: {
          id: categoryId,
          organizationId,
          direction,
          isActive: true,
        },
      });

      if (!category) {
        return NextResponse.json(
          {
            error:
              "Kategori bulunamadı veya işlem türüyle uyumsuz.",
          },
          { status: 400 }
        );
      }
    }

    // ==================================================
    // CREATE TRANSACTION
    // ==================================================

    const transaction =
      await serialCashTransaction(prisma, async (tx) => {
        const attempt = await mutationReplay(tx, organizationId, "finance.manual.request", data.idempotencyKey, { accountId, categoryId: categoryId ?? null, direction, amount: parsedAmount.toString(), description: description ?? null, reference: reference ?? null, occurredAt: occurredAt ?? null });
        if (attempt.entityId) return tx.financeTransaction.findFirstOrThrow({ where: { id: attempt.entityId, organizationId, ...branchScope(membership) }, include: { branch: { select: { id: true, name: true } }, account: { select: { id: true, name: true, type: true } }, category: { select: { id: true, name: true } } } });
        const current = await tx.financeAccount.findFirst({ where: { AND: [{ id: account.id, organizationId, isActive: true }, branchScope(membership)] } });
        if (!current) throw new CashError("Aktif finans hesabı bulunamadı.", 404);
        if (direction === FinanceDirection.OUT) await assertCashAvailable(tx, current, parsedAmount);
        const entry = await tx.financeTransaction.create({
        data: {
          organizationId,
          branchId: account.branchId,
          accountId: account.id,

          categoryId:
            typeof categoryId === "string"
              ? categoryId
              : null,

          direction,
          source: "MANUAL",

          amount: parsedAmount,

          description:
            typeof description === "string"
              ? description.trim() || null
              : null,

          reference:
            typeof reference === "string"
              ? reference.trim() || null
              : null,

          occurredAt: transactionDate,
        },

        include: {
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
          account: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }); await writeAudit(tx, membership, "finance.manual.create", "FinanceTransaction", entry.id, entry.branchId); await rememberMutation(tx, membership, attempt, "finance.manual.request", "FinanceTransaction", entry.id, entry.branchId); return entry; });

    // ==================================================
    // RESPONSE
    // ==================================================

    return NextResponse.json(
      {
        success: true,

        message:
          direction === FinanceDirection.IN
            ? "Gelir kaydı başarıyla oluşturuldu."
            : "Gider kaydı başarıyla oluşturuldu.",

        transaction: {
          ...transaction,
          amount: transaction.amount.toString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CashError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Finance transactions POST error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      {
        error: "Finans hareketi oluşturulamadı.",
      },
      { status: 500 }
    );
  }
}

export const GET = withPermission("finance.manage", handleGET);

export const POST = withPermission("finance.manage", handlePOST);
