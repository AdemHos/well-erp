import { branchIdScope } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import POSManager from "@/components/pos/POSManager";
import { branchPolicy } from "@/lib/settings-policy";

export const dynamic = "force-dynamic";

export default async function POSPage() {
  // =====================================================
  // 1. AUTHENTICATION
  // =====================================================

  const membership = await requirePagePermission("pos.sell");

  if (!membership) {
    redirect("/onboarding");
  }

  const organizationId = membership.organizationId;

  // =====================================================
  // 2. FETCH POS DATA
  // =====================================================

  const [products, categories, branches] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
        isSellable: true,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    }),

    prisma.category.findMany({
      where: {
        organizationId,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    }),

    prisma.branch.findMany({
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
    }),
  ]);

  // =====================================================
  // 3. ACTIVE BRANCH
  // =====================================================

  const cookieStore = await cookies();

  const savedBranchId = cookieStore.get(
    "wellpos-active-branch"
  )?.value;

  // Seçilen şubenin mevcut organizasyona ait
  // olduğunu kontrol ediyoruz.
  const activeBranch =
    branches.find((branch) => branch.id === savedBranchId) ??
    branches[0];

  // =====================================================
  // 4. NO BRANCH STATE
  // =====================================================

  if (!activeBranch) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
        <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400">
          Şube Bulunamadı
        </h2>

        <p className="mt-2 text-sm text-amber-700/80 dark:text-amber-300">
          İşletmenize ait bir şube bulunamadı.
          POS üzerinden satış yapabilmek için
          önce bir şube oluşturmanız gerekiyor.
        </p>
      </div>
    );
  }

  // =====================================================
  // 5. SERIALIZE PRISMA DECIMAL VALUES
  // =====================================================

  const serializedProducts = products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    sku: product.sku,
    barcode: product.barcode,
    imageUrl: product.imageUrl,
    unit: product.unit,
    price: product.price.toString(),

    category: product.category
      ? {
          id: product.category.id,
          name: product.category.name,
        }
      : null,
  }));

  const serializedCategories = categories.map((category) => ({
    id: category.id,
    name: category.name,
  }));

  // =====================================================
  // 6. RENDER POS
  // =====================================================

  const financeAccounts = await prisma.financeAccount.findMany({
    where: { organizationId, branchId: activeBranch.id, isActive: true, type: { in: ["CASH", "CARD"] } },
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });

  return (
    <POSManager
      policy={await branchPolicy(prisma, organizationId, activeBranch.id)}
      actorRole={membership.role}
      key={activeBranch.id}
      branchId={activeBranch.id}
      products={serializedProducts}
      categories={serializedCategories}
      financeAccounts={financeAccounts}
    />
  );
}
