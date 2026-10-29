import { requirePagePermission } from "@/lib/rbac";

import { prisma } from "@/lib/prisma";

import CategoryManager from "@/components/categories/CategoryManager";

export default async function CategoriesPage() {
  const membership = await requirePagePermission("products.manage");

  const categories = await prisma.category.findMany({
    where: {
      organizationId: membership.organizationId,
    },
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-950">
          Kategoriler
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Ürün kategorilerinizi oluşturun ve yönetin.
        </p>
      </div>

      <CategoryManager
        initialCategories={categories.map((category) => ({
          ...category,
          createdAt: category.createdAt.toISOString(),
          updatedAt: category.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}