import { branchIdScope, branchScope } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";

import StockManager from "@/components/stock/StockManager";
import StockMovementList from "@/components/stock/StockMovementList";
import StockOperationForm from "@/components/stock/StockOperationsForn";

export default async function StockPage() {
  const membership = await requirePagePermission("stock.manage");
  const organizationId = membership.organizationId;

  // İşletmeye ait tüm şubeleri getir.
  const branches = await prisma.branch.findMany({
    where: { AND: [{
      organizationId,
    }, branchIdScope(membership)] },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  if (branches.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-xl font-bold text-slate-950">
          Stok Yönetimi
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Stok yönetimini kullanabilmek için önce bir şube
          oluşturmalısınız.
        </p>
      </div>
    );
  }

  // Kullanıcının seçtiği aktif şubeyi belirle.
  const cookieStore = await cookies();

  const savedBranchId = cookieStore.get(
    "wellpos-active-branch"
  )?.value;

  const activeBranch =
    branches.find(
      (branch) => branch.id === savedBranchId
    ) ?? branches[0];

  // Yalnızca aktif şubenin stokları ve hareketleri.
  const [stocks, products, movements] = await Promise.all([
    prisma.branchStock.findMany({
      where: { AND: [{
        organizationId,
        branchId: activeBranch.id,
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
    }),

    prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
      },
      orderBy: {
        name: "asc",
      },
    }),

    prisma.stockMovement.findMany({
      where: { AND: [{
        organizationId,
        branchId: activeBranch.id,
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
    }),
  ]);

  // Prisma Decimal değerlerini Client Component
  // içerisinde kullanılabilecek string değerlerine dönüştür.
  const serializedStocks = stocks.map((stock) => ({
    ...stock,
    quantity: stock.quantity.toString(),
    criticalLevel: stock.criticalLevel.toString(),
  }));

  const serializedMovements = movements.map(
    (movement) => ({
      ...movement,
      quantity: movement.quantity.toString(),
      createdAt: movement.createdAt.toISOString(),
    })
  );

  // Stok girişi ve stok operasyonları yalnızca
  // aktif şubede gerçekleştirilecek.
  const selectedBranches = [activeBranch];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">
            Stok Yönetimi
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            {activeBranch.name} şubesinin stoklarını,
            transferlerini ve hareketlerini yönetin.
          </p>
        </div>

        {/* Stock Operations */}
        <StockOperationForm
          key={activeBranch.id}
          products={products}
          branches={selectedBranches}
        />
      </div>

      <div className="space-y-8">
        {/* Current Stocks */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Mevcut Stoklar
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {activeBranch.name} şubesindeki güncel ürün
              miktarları ve şubeler arası stok transferleri.
            </p>
          </div>

          <StockManager
            key={activeBranch.id}
            initialStocks={serializedStocks}
            products={products}
            branches={selectedBranches}
            allBranches={branches}
          />
        </section>

        {/* Stock Movements */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Stok Hareketleri
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {activeBranch.name} şubesindeki son 100 stok
              hareketi.
            </p>
          </div>

          <StockMovementList
            key={activeBranch.id}
            movements={serializedMovements}
          />
        </section>
      </div>
    </div>
  );
}
