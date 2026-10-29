import { requirePagePermission } from "@/lib/rbac";

import { redirect } from "next/navigation";
import {
  Calculator,
  ChefHat,
  Package,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

import RecipeManager from "@/components/recipes/RecipeManager";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  // ==========================================
  // AUTH / ORGANIZATION
  // ==========================================

  const membership = await requirePagePermission("recipes.manage");

  if (!membership) {
    redirect("/login");
  }

  const organizationId = membership.organizationId;

  // ==========================================
  // DATABASE QUERIES
  // ==========================================

  const [products, recipes] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId,
        isActive: true,
      },

      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        costPrice: true,
        unit: true,
      },

      orderBy: {
        name: "asc",
      },
    }),

    prisma.recipe.findMany({
      where: {
        organizationId,
      },

      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            unit: true,
          },
        },

        items: {
          include: {
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
            createdAt: "asc",
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  // ==========================================
  // SERIALIZE PRODUCTS
  // ==========================================

  const serializedProducts = products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price.toString(),
    costPrice: product.costPrice?.toString() ?? null,
    unit: product.unit,
  }));

  // ==========================================
  // SERIALIZE RECIPES + COST CALCULATION
  // ==========================================

  const serializedRecipes = recipes.map((recipe) => {
    const hasMissingCosts = recipe.items.some(
      (item) => item.ingredient.costPrice === null
    );

    const totalCost = recipe.items.reduce(
      (sum, item) => {
        if (item.ingredient.costPrice === null) {
          return sum;
        }

        return sum.plus(
          item.quantity.mul(item.ingredient.costPrice)
        );
      },
      new Prisma.Decimal(0)
    );

    const costPerUnit = totalCost.div(
      recipe.yieldQuantity
    );

    return {
      id: recipe.id,
      name: recipe.name,
      productId: recipe.productId,
      isActive: recipe.isActive,
      yieldQuantity: recipe.yieldQuantity.toString(),
      createdAt: recipe.createdAt.toISOString(),

      product: {
        id: recipe.product.id,
        name: recipe.product.name,
        sku: recipe.product.sku,
        price: recipe.product.price.toString(),
        unit: recipe.product.unit,
      },

      items: recipe.items.map((item) => ({
        id: item.id,
        ingredientId: item.ingredientId,
        quantity: item.quantity.toString(),

        ingredient: {
          id: item.ingredient.id,
          name: item.ingredient.name,
          unit: item.ingredient.unit,
          costPrice:
            item.ingredient.costPrice?.toString() ??
            null,
        },
      })),

      totalCost: hasMissingCosts
        ? null
        : totalCost.toDecimalPlaces(2).toString(),

      costPerUnit: hasMissingCosts
        ? null
        : costPerUnit.toDecimalPlaces(2).toString(),

      hasMissingCosts,
    };
  });

  // ==========================================
  // SUMMARY
  // ==========================================

  const totalRecipes = serializedRecipes.length;

  const activeRecipes = serializedRecipes.filter(
    (recipe) => recipe.isActive
  ).length;

  const recipesWithCosts = serializedRecipes.filter(
    (recipe) => !recipe.hasMissingCosts
  ).length;

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
            <ChefHat size={25} />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Reçete Yönetimi
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Ürün reçetelerini, malzemelerini ve
              maliyetlerini yönetin.
            </p>
          </div>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* TOTAL RECIPES */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5">
              <ChefHat
                size={20}
                className="text-blue-600"
              />
            </div>

            <span className="text-sm font-medium text-slate-500">
              Toplam Reçete
            </span>
          </div>

          <p className="mt-4 text-3xl font-bold text-slate-900">
            {totalRecipes}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Sistemde kayıtlı reçeteler
          </p>
        </div>

        {/* ACTIVE RECIPES */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5">
              <Package
                size={20}
                className="text-emerald-600"
              />
            </div>

            <span className="text-sm font-medium text-slate-500">
              Aktif Reçete
            </span>
          </div>

          <p className="mt-4 text-3xl font-bold text-slate-900">
            {activeRecipes}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Kullanıma açık reçeteler
          </p>
        </div>

        {/* RECIPES WITH COSTS */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-violet-50 p-2.5">
              <Calculator
                size={20}
                className="text-violet-600"
              />
            </div>

            <span className="text-sm font-medium text-slate-500">
              Maliyeti Hesaplanan
            </span>
          </div>

          <p className="mt-4 text-3xl font-bold text-slate-900">
            {recipesWithCosts}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Malzeme maliyetleri eksiksiz reçeteler
          </p>
        </div>
      </div>

      {/* RECIPE MANAGER */}
      <RecipeManager
        products={serializedProducts}
        recipes={serializedRecipes}
      />
    </div>
  );
}
