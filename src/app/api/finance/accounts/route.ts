import { writeAudit } from "@/lib/audit";
import { withPermission } from "@/lib/rbac";
import { branchScope, branchIdScope } from "@/lib/permissions";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_TYPES = ["CASH", "CARD", "BANK"] as const;

type AccountType = (typeof ACCOUNT_TYPES)[number];

function isAccountType(value: unknown): value is AccountType {
  return (
    typeof value === "string" &&
    ACCOUNT_TYPES.some((type) => type === value)
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

    if (!amount.isFinite() || amount.decimalPlaces() > 2) {
      return null;
    }

    if (amount.abs().greaterThan("999999999999.99")) {
      return null;
    }

    return amount;
  } catch {
    return null;
  }
}

// ======================================================
// GET /api/finance/accounts
// List finance accounts with current balances
// ======================================================

async function handleGET() {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    const organizationId = membership.organizationId;

    const [accounts, transactions] = await Promise.all([
      prisma.financeAccount.findMany({
        where: { AND: [{ organizationId }, branchScope(membership)] },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
        ],
      }),

      prisma.financeTransaction.groupBy({
        by: ["accountId", "direction"],
        where: { AND: [{ organizationId }, branchScope(membership)] },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totals = new Map<
      string,
      { incoming: Prisma.Decimal; outgoing: Prisma.Decimal }
    >();

    for (const transaction of transactions) {
      const current = totals.get(transaction.accountId) ?? {
        incoming: new Prisma.Decimal(0),
        outgoing: new Prisma.Decimal(0),
      };

      const amount =
        transaction._sum.amount ?? new Prisma.Decimal(0);

      if (transaction.direction === "IN") {
        current.incoming = current.incoming.plus(amount);
      } else {
        current.outgoing = current.outgoing.plus(amount);
      }

      totals.set(transaction.accountId, current);
    }

    const result = accounts.map((account) => {
      const movement = totals.get(account.id) ?? {
        incoming: new Prisma.Decimal(0),
        outgoing: new Prisma.Decimal(0),
      };

      const balance = account.openingBalance
        .plus(movement.incoming)
        .minus(movement.outgoing);

      return {
        id: account.id,
        organizationId: account.organizationId,
        branchId: account.branchId,
        branch: account.branch,
        name: account.name,
        type: account.type,
        openingBalance: account.openingBalance.toString(),
        totalIncoming: movement.incoming.toString(),
        totalOutgoing: movement.outgoing.toString(),
        balance: balance.toString(),
        isActive: account.isActive,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      accounts: result,
    });
  } catch (error) {
    console.error("Finance accounts GET error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Finans hesapları getirilemedi." },
      { status: 500 }
    );
  }
}

// ======================================================
// POST /api/finance/accounts
// Create a new finance account
// ======================================================

async function handlePOST(request: NextRequest) {
  try {
    const membership = await getCurrentMembership();

    if (!membership) {
      return NextResponse.json(
        { error: "Oturum açmanız gerekiyor." },
        { status: 401 }
      );
    }

    

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

    const { branchId, type, openingBalance } = data;

    const name =
      typeof data.name === "string" ? data.name.trim() : "";

    if (
      !name ||
      name.length > 100 ||
      typeof branchId !== "string" ||
      !branchId.trim() ||
      !isAccountType(type)
    ) {
      return NextResponse.json(
        { error: "Hesap adı, şube ve hesap türü zorunludur." },
        { status: 400 }
      );
    }

    const initialBalance = parseAmount(
      openingBalance ?? 0
    );

    if (
      initialBalance === null ||
      initialBalance.isNegative()
    ) {
      return NextResponse.json(
        {
          error:
            "Açılış bakiyesi sıfır veya pozitif bir tutar olmalıdır.",
        },
        { status: 400 }
      );
    }

    const organizationId = membership.organizationId;

    // Verify branch ownership
    const branch = await prisma.branch.findFirst({
      where: { AND: [{
        id: branchId,
        organizationId,
      }, branchIdScope(membership)] },
      select: {
        id: true,
      },
    });

    if (!branch) {
      return NextResponse.json(
        { error: "Şube bulunamadı." },
        { status: 404 }
      );
    }

    const account = await prisma.$transaction(async (tx) => { const entry = await tx.financeAccount.create({
      data: {
        organizationId,
        branchId,
        name,
        type,
        openingBalance: initialBalance,
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }); await writeAudit(tx, membership, "finance.account.create", "FinanceAccount", entry.id, entry.branchId); return entry; });

    return NextResponse.json(
      {
        success: true,
        message: "Finans hesabı oluşturuldu.",
        account: {
          ...account,
          openingBalance: account.openingBalance.toString(),
          balance: account.openingBalance.toString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "Bu şubede aynı isimde bir finans hesabı zaten var.",
        },
        { status: 409 }
      );
    }

    console.error("Finance accounts POST error:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Finans hesabı oluşturulamadı." },
      { status: 500 }
    );
  }
}

export const GET = withPermission("finance.manage", handleGET);

export const POST = withPermission("finance.manage", handlePOST);
