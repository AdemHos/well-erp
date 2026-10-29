import { branchIdScope, branchScope } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import ProductionManager from "@/components/productions/ProdutionManager";

export const dynamic = "force-dynamic";

export default async function ProductionsPage() {
  const membership = await requirePagePermission("production.manage");

  if (!membership) {
    redirect("/login");
  }

  const organizationId = membership.organizationId;

  // Fetch all data for the current organization
  const [branches, recipes, stocks] = await Promise.all([
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

    prisma.recipe.findMany({
      where: {
        organizationId,
        isActive: true,
        product: {
          isActive: true,
        },
      },
      select: {
        id: true,
        name: true,
        yieldQuantity: true,
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            ingredient: {
              select: {
                id: true,
                name: true,
                unit: true,
                costPrice: true,
              },
            },
          },
          orderBy: {
            ingredient: {
              name: "asc",
            },
          },
        },
      },
      orderBy: {
        product: {
          name: "asc",
        },
      },
    }),

    prisma.branchStock.findMany({
      where: { AND: [{
        organizationId,
      }, branchScope(membership)] },
      select: {
        branchId: true,
        productId: true,
        quantity: true,
      },
    }),
  ]);

  // Prisma Decimal values must be serialized before
  // passing data into the Client Component.
  const serializedRecipes = recipes.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    yieldQuantity: recipe.yieldQuantity.toString(),
    product: {
      id: recipe.product.id,
      name: recipe.product.name,
      unit: recipe.product.unit,
    },
    items: recipe.items.map((item) => ({
      id: item.id,
      quantity: item.quantity.toString(),
      ingredient: {
        id: item.ingredient.id,
        name: item.ingredient.name,
        unit: item.ingredient.unit,
        costPrice:
          item.ingredient.costPrice?.toString() ?? null,
      },
    })),
  }));

  const serializedStocks = stocks.map((stock) => ({
    branchId: stock.branchId,
    productId: stock.productId,
    quantity: stock.quantity.toString(),
  }));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Üretim Yönetimi
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Reçetelere göre üretim yapın, hammadde
          tüketimini ve üretim maliyetlerini takip edin.
        </p>
      </div>

      <ProductionManager
        branches={branches}
        recipes={serializedRecipes}
        stocks={serializedStocks}
      />
    </div>
  );
}
