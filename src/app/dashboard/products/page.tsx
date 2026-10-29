import { requirePagePermission } from "@/lib/rbac";

import { prisma } from "@/lib/prisma";

import ProductManager from "@/components/products/ProductManager";

export default async function ProductsPage() {
  const membership = await requirePagePermission("products.manage");

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId: membership.organizationId,
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
        createdAt: "desc",
      },
    }),

    prisma.category.findMany({
      where: {
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  const serializedProducts = products.map((product) => ({
    ...product,

    // Prisma Decimal değerlerini Client Component'a
    // string olarak gönderiyoruz.
    price: product.price.toString(),

    costPrice:
      product.costPrice !== null
        ? product.costPrice.toString()
        : null,

    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-950">
          Ürünler
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Ürünlerinizi, fiyatlarınızı ve kategorilerinizi yönetin.
        </p>
      </div>

      <ProductManager
        initialProducts={serializedProducts}
        categories={categories}
      />
    </div>
  );
}