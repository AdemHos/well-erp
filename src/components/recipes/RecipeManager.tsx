
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ChefHat,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

type ProductUnit =
  | "PIECE"
  | "GRAM"
  | "KILOGRAM"
  | "MILLILITER"
  | "LITER";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  costPrice: string | null;
  unit: ProductUnit;
};

type RecipeItem = {
  id: string;
  ingredientId: string;
  quantity: string;
  ingredient: {
    id: string;
    name: string;
    unit: ProductUnit;
    costPrice: string | null;
  };
};

type Recipe = {
  id: string;
  name: string | null;
  productId: string;
  isActive: boolean;
  yieldQuantity: string;
  createdAt: string;
  product: {
    id: string;
    name: string;
    sku: string | null;
    price: string;
    unit: ProductUnit;
  };
  items: RecipeItem[];
  totalCost: string | null;
  costPerUnit: string | null;
  hasMissingCosts: boolean;
};

type Props = {
  products: Product[];
  recipes: Recipe[];
};

type FormItem = {
  key: number;
  ingredientId: string;
  quantity: string;
};

type FormMode = "create" | "edit";

const unitLabels: Record<ProductUnit, string> = {
  PIECE: "Adet",
  GRAM: "Gram",
  KILOGRAM: "Kilogram",
  MILLILITER: "Mililitre",
  LITER: "Litre",
};

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

const numberFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 3,
});

function formatMoney(value: number) {
  return currencyFormatter.format(value);
}

function parseQuantity(value: string) {
  const text = value.trim();

  if (!/^\d+([.,]\d{1,3})?$/.test(text)) {
    return null;
  }

  const quantity = Number(text.replace(",", "."));

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 99999999999.999
  ) {
    return null;
  }

  return quantity;
}

async function readApiError(
  response: Response,
  fallback: string
) {
  const data = await response.json().catch(() => null);

  return typeof data?.error === "string"
    ? data.error
    : fallback;
}

export default function RecipeManager({
  products,
  recipes,
}: Props) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingRecipeId, setEditingRecipeId] =
    useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);
  const [togglingId, setTogglingId] =
    useState<string | null>(null);

  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [success, setSuccess] = useState("");

  const [expandedRecipeId, setExpandedRecipeId] =
    useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [yieldQuantity, setYieldQuantity] = useState("1");
  const [isActive, setIsActive] = useState(true);

  const [items, setItems] = useState<FormItem[]>([
    {
      key: 1,
      ingredientId: "",
      quantity: "",
    },
  ]);

  const [nextItemKey, setNextItemKey] = useState(2);

  // ==========================================
  // DERIVED DATA
  // ==========================================

  const availableProducts = useMemo(() => {
    const usedProductIds = new Set(
      recipes.map((recipe) => recipe.productId)
    );

    return products.filter(
      (product) => !usedProductIds.has(product.id)
    );
  }, [products, recipes]);

  const filteredRecipes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");

    if (!query) return recipes;

    return recipes.filter((recipe) => {
      const searchable = [
        recipe.product.name,
        recipe.product.sku,
        recipe.name,
        ...recipe.items.map(
          (item) => item.ingredient.name
        ),
      ];

      return searchable.some((value) =>
        (value ?? "")
          .toLocaleLowerCase("tr-TR")
          .includes(query)
      );
    });
  }, [recipes, search]);

  const selectedProduct =
    products.find((product) => product.id === productId) ??
    recipes.find((recipe) => recipe.productId === productId)
      ?.product;

  const calculatedCosts = useMemo(() => {
    let total = 0;
    let missingCost = false;

    for (const item of items) {
      if (!item.ingredientId) continue;

      const product = products.find(
        (candidate) =>
          candidate.id === item.ingredientId
      );

      const existingIngredient = recipes
        .flatMap((recipe) => recipe.items)
        .find(
          (candidate) =>
            candidate.ingredientId === item.ingredientId
        )?.ingredient;

      const costPrice =
        product?.costPrice ??
        existingIngredient?.costPrice ??
        null;

      const quantity = parseQuantity(item.quantity);

      if (quantity === null) continue;

      if (costPrice === null) {
        missingCost = true;
        continue;
      }

      total += Number(costPrice) * quantity;
    }

    const yieldValue = parseQuantity(yieldQuantity);

    return {
      total,
      perUnit:
        yieldValue !== null ? total / yieldValue : 0,
      missingCost,
    };
  }, [items, products, recipes, yieldQuantity]);

  const salePrice = selectedProduct
    ? Number(selectedProduct.price)
    : 0;

  const grossProfit =
    salePrice - calculatedCosts.perUnit;

  const grossMargin =
    salePrice > 0
      ? (grossProfit / salePrice) * 100
      : 0;

  // ==========================================
  // FORM HELPERS
  // ==========================================

  function resetForm() {
    setFormMode("create");
    setEditingRecipeId(null);
    setProductId("");
    setRecipeName("");
    setYieldQuantity("1");
    setIsActive(true);
    setItems([
      {
        key: 1,
        ingredientId: "",
        quantity: "",
      },
    ]);
    setNextItemKey(2);
    setError("");
  }

  function openCreateModal() {
    resetForm();
    setPageError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  function openEditModal(recipe: Recipe) {
    setFormMode("edit");
    setEditingRecipeId(recipe.id);
    setProductId(recipe.productId);
    setRecipeName(recipe.name ?? "");
    setYieldQuantity(recipe.yieldQuantity);
    setIsActive(recipe.isActive);

    setItems(
      recipe.items.map((item, index) => ({
        key: index + 1,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
      }))
    );

    setNextItemKey(recipe.items.length + 1);
    setError("");
    setPageError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;

    setIsModalOpen(false);
    resetForm();
  }

  function addIngredient() {
    if (items.length >= 100) return;

    setItems((current) => [
      ...current,
      {
        key: nextItemKey,
        ingredientId: "",
        quantity: "",
      },
    ]);

    setNextItemKey((current) => current + 1);
  }

  function removeIngredient(key: number) {
    setItems((current) =>
      current.filter((item) => item.key !== key)
    );
  }

  function updateIngredient(
    key: number,
    field: "ingredientId" | "quantity",
    value: string
  ) {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, [field]: value }
          : item
      )
    );
  }

  // ==========================================
  // CREATE / UPDATE
  // ==========================================

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setPageError("");
    setSuccess("");

    if (!productId) {
      setError("Lütfen bir ürün seçin.");
      return;
    }

    const yieldValue = parseQuantity(yieldQuantity);

    if (yieldValue === null) {
      setError("Geçerli bir çıktı miktarı girin.");
      return;
    }

    if (items.length === 0) {
      setError("En az bir malzeme eklemelisiniz.");
      return;
    }

    const seen = new Set<string>();

    const parsedItems: {
      ingredientId: string;
      quantity: string;
    }[] = [];

    for (const item of items) {
      if (!item.ingredientId) {
        setError("Tüm satırlarda malzeme seçmelisiniz.");
        return;
      }

      if (item.ingredientId === productId) {
        setError(
          "Reçete ürünü kendi malzemesi olamaz."
        );
        return;
      }

      if (seen.has(item.ingredientId)) {
        setError(
          "Aynı malzemeyi birden fazla ekleyemezsiniz."
        );
        return;
      }

      const quantity = parseQuantity(item.quantity);

      if (quantity === null) {
        setError(
          "Tüm malzemeler için geçerli miktar girin."
        );
        return;
      }

      seen.add(item.ingredientId);

      parsedItems.push({
        ingredientId: item.ingredientId,
        quantity: String(quantity),
      });
    }

    const editing =
      formMode === "edit" && editingRecipeId !== null;

    const url = editing
      ? `/api/recipes/${editingRecipeId}`
      : "/api/recipes";

    const payload = editing
      ? {
          name: recipeName.trim(),
          yieldQuantity: String(yieldValue),
          isActive,
          items: parsedItems,
        }
      : {
          productId,
          name: recipeName.trim(),
          yieldQuantity: String(yieldValue),
          isActive,
          items: parsedItems,
        };

    setSaving(true);

    try {
      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            editing
              ? "Reçete güncellenemedi."
              : "Reçete oluşturulamadı."
          )
        );
      }

      setIsModalOpen(false);
      resetForm();

      setSuccess(
        editing
          ? "Reçete başarıyla güncellendi."
          : "Reçete başarıyla oluşturuldu."
      );

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Beklenmeyen bir hata oluştu."
      );
    } finally {
      setSaving(false);
    }
  }

  // ==========================================
  // DELETE
  // ==========================================

  async function handleDelete(recipe: Recipe) {
    if (deletingId || togglingId || saving) return;

    const confirmed = window.confirm(
      `"${recipe.product.name}" reçetesini silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz.`
    );

    if (!confirmed) return;

    setDeletingId(recipe.id);
    setPageError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/recipes/${recipe.id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Reçete silinemedi."
          )
        );
      }

      if (expandedRecipeId === recipe.id) {
        setExpandedRecipeId(null);
      }

      setSuccess("Reçete başarıyla silindi.");
      router.refresh();
    } catch (err) {
      setPageError(
        err instanceof Error
          ? err.message
          : "Reçete silinirken hata oluştu."
      );
    } finally {
      setDeletingId(null);
    }
  }

  // ==========================================
  // ACTIVE / PASSIVE
  // ==========================================

  async function handleToggleActive(recipe: Recipe) {
    if (togglingId || deletingId || saving) return;

    setTogglingId(recipe.id);
    setPageError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/recipes/${recipe.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isActive: !recipe.isActive,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Reçete durumu değiştirilemedi."
          )
        );
      }

      setSuccess(
        recipe.isActive
          ? "Reçete pasif hale getirildi."
          : "Reçete aktif hale getirildi."
      );

      router.refresh();
    } catch (err) {
      setPageError(
        err instanceof Error
          ? err.message
          : "Reçete durumu değiştirilemedi."
      );
    } finally {
      setTogglingId(null);
    }
  }

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Reçete Listesi
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Reçeteleri oluşturun, düzenleyin ve yönetin.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            disabled={availableProducts.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} />
            Yeni Reçete
          </button>
        </div>

        {/* SEARCH */}
        <div className="border-b border-slate-100 p-5">
          <div className="relative max-w-sm">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Ürün, reçete veya malzeme ara..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/* MESSAGES */}
        {success && (
          <div className="mx-5 mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {success}
          </div>
        )}

        {pageError && (
          <div className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {pageError}
          </div>
        )}

        {/* TABLE */}
        {filteredRecipes.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <div className="rounded-2xl bg-slate-100 p-4 text-slate-400">
              <ChefHat size={30} />
            </div>

            <h3 className="mt-4 font-semibold text-slate-800">
              {search
                ? "Eşleşen reçete bulunamadı"
                : "Henüz reçete oluşturulmadı"}
            </h3>

            <p className="mt-2 text-sm text-slate-500">
              {search
                ? "Farklı bir arama terimi deneyin."
                : "Yeni bir reçete oluşturarak başlayabilirsiniz."}
            </p>

            {!search && availableProducts.length > 0 && (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                İlk reçeteyi oluştur
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left">
                  {[
                    "Ürün / Reçete",
                    "Malzeme",
                    "Birim Maliyet",
                    "Satış Fiyatı",
                    "Durum",
                    "İşlemler",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="px-5 py-3 text-xs font-semibold uppercase text-slate-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredRecipes.map((recipe) => {
                  const expanded =
                    expandedRecipeId === recipe.id;

                  const isDeleting =
                    deletingId === recipe.id;

                  const isToggling =
                    togglingId === recipe.id;

                  return (
                    <RecipeRow
                      key={recipe.id}
                      recipe={recipe}
                      expanded={expanded}
                      isDeleting={isDeleting}
                      isToggling={isToggling}
                      onToggleDetails={() =>
                        setExpandedRecipeId(
                          expanded ? null : recipe.id
                        )
                      }
                      onEdit={() =>
                        openEditModal(recipe)
                      }
                      onDelete={() =>
                        handleDelete(recipe)
                      }
                      onToggleActive={() =>
                        handleToggleActive(recipe)
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-modal-title"
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2
                  id="recipe-modal-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {formMode === "create"
                    ? "Yeni Reçete Oluştur"
                    : "Reçete Düzenle"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Ürün, malzeme ve maliyet bilgilerini yönetin.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Kapat"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={handleSubmit}
              className="overflow-y-auto p-5"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {/* PRODUCT */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Reçete Ürünü *
                  </label>

                  <select
                    value={productId}
                    onChange={(event) =>
                      setProductId(event.target.value)
                    }
                    disabled={formMode === "edit"}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="">
                      Ürün seçin
                    </option>

                    {formMode === "edit" &&
                      selectedProduct && (
                        <option value={selectedProduct.id}>
                          {selectedProduct.name}
                        </option>
                      )}

                    {formMode === "create" &&
                      availableProducts.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                        >
                          {product.name}
                        </option>
                      ))}
                  </select>

                  {formMode === "edit" && (
                    <p className="mt-1 text-xs text-slate-400">
                      Mevcut reçetenin ürünü değiştirilemez.
                    </p>
                  )}
                </div>

                {/* NAME */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Reçete Adı
                  </label>

                  <input
                    value={recipeName}
                    onChange={(event) =>
                      setRecipeName(event.target.value)
                    }
                    maxLength={200}
                    placeholder="Örn: Standart Cheeseburger"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                {/* YIELD */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Reçete Çıktı Miktarı *
                  </label>

                  <div className="flex gap-2">
                    <input
                      value={yieldQuantity}
                      onChange={(event) =>
                        setYieldQuantity(event.target.value)
                      }
                      inputMode="decimal"
                      required
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    />

                    <span className="flex items-center rounded-xl bg-slate-100 px-3 text-xs text-slate-600">
                      {selectedProduct
                        ? unitLabels[selectedProduct.unit]
                        : "Birim"}
                    </span>
                  </div>
                </div>

                {/* STATUS */}
                <div className="flex items-end">
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(event) =>
                        setIsActive(event.target.checked)
                      }
                      className="h-4 w-4 accent-blue-600"
                    />
                    Aktif reçete
                  </label>
                </div>
              </div>

              {/* INGREDIENTS */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Reçete Malzemeleri
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Miktarları malzemenin stok birimine göre girin.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addIngredient}
                    disabled={items.length >= 100}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                  >
                    <Plus size={15} />
                    Malzeme Ekle
                  </button>
                </div>

                <div className="space-y-3">
                  {items.map((item, index) => {
                    const ingredient =
                      products.find(
                        (product) =>
                          product.id === item.ingredientId
                      ) ??
                      recipes
                        .flatMap((recipe) => recipe.items)
                        .find(
                          (candidate) =>
                            candidate.ingredientId ===
                            item.ingredientId
                        )?.ingredient;

                    const selectedIds = new Set(
                      items
                        .filter(
                          (current) =>
                            current.key !== item.key
                        )
                        .map(
                          (current) =>
                            current.ingredientId
                        )
                    );

                    return (
                      <div
                        key={item.key}
                        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[1fr_150px_36px]"
                      >
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Malzeme {index + 1}
                          </label>

                          <select
                            value={item.ingredientId}
                            onChange={(event) =>
                              updateIngredient(
                                item.key,
                                "ingredientId",
                                event.target.value
                              )
                            }
                            required
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                          >
                            <option value="">
                              Malzeme seçin
                            </option>

                            {ingredient &&
                              !products.some(
                                (product) =>
                                  product.id === ingredient.id
                              ) && (
                                <option value={ingredient.id}>
                                  {ingredient.name} (Mevcut)
                                </option>
                              )}

                            {products
                              .filter(
                                (product) =>
                                  product.id !== productId &&
                                  !selectedIds.has(product.id)
                              )
                              .map((product) => (
                                <option
                                  key={product.id}
                                  value={product.id}
                                >
                                  {product.name} (
                                  {unitLabels[product.unit]})
                                </option>
                              ))}
                          </select>

                          {ingredient?.costPrice === null && (
                            <p className="mt-1 text-xs text-amber-600">
                              Birim maliyet tanımlanmamış.
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-slate-500">
                            Miktar{" "}
                            {ingredient
                              ? `(${unitLabels[ingredient.unit]})`
                              : ""}
                          </label>

                          <input
                            value={item.quantity}
                            onChange={(event) =>
                              updateIngredient(
                                item.key,
                                "quantity",
                                event.target.value
                              )
                            }
                            inputMode="decimal"
                            placeholder="Örn: 150"
                            required
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() =>
                              removeIngredient(item.key)
                            }
                            aria-label="Malzemeyi kaldır"
                            title="Malzemeyi kaldır"
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* COST ANALYSIS */}
              <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Calculator
                    size={18}
                    className="text-blue-600"
                  />

                  <h3 className="font-semibold text-slate-900">
                    Maliyet Analizi
                  </h3>
                </div>

                {calculatedCosts.missingCost && (
                  <p className="mb-3 text-sm text-amber-700">
                    Bazı malzemelerin birim maliyetleri eksik.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">
                      Toplam Reçete Maliyeti
                    </p>

                    <p className="mt-1 text-xl font-bold text-slate-900">
                      {calculatedCosts.missingCost
                        ? "Eksik maliyet"
                        : formatMoney(calculatedCosts.total)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500">
                      Birim Maliyet
                    </p>

                    <p className="mt-1 text-xl font-bold text-slate-900">
                      {calculatedCosts.missingCost
                        ? "Eksik maliyet"
                        : formatMoney(calculatedCosts.perUnit)}
                    </p>
                  </div>

                  {selectedProduct &&
                    !calculatedCosts.missingCost && (
                      <>
                        <div>
                          <p className="text-xs text-slate-500">
                            Tahmini Brüt Kâr / Birim
                          </p>

                          <p
                            className={`mt-1 text-lg font-bold ${
                              grossProfit >= 0
                                ? "text-emerald-700"
                                : "text-red-600"
                            }`}
                          >
                            {formatMoney(grossProfit)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500">
                            Tahmini Brüt Kâr Marjı
                          </p>

                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {grossMargin.toFixed(1)}%
                          </p>
                        </div>
                      </>
                    )}
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Bu hesaplama yalnızca tanımlanan malzeme
                  maliyetlerine dayanır; işçilik, vergi ve
                  diğer giderler dahil değildir.
                </p>
              </div>

              {/* ERROR */}
              {error && (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* FOOTER */}
              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving && (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Kaydediliyor..."
                    : formMode === "create"
                      ? "Reçeteyi Kaydet"
                      : "Değişiklikleri Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ==========================================
// RECIPE TABLE ROW
// ==========================================

function RecipeRow({
  recipe,
  expanded,
  isDeleting,
  isToggling,
  onToggleDetails,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  recipe: Recipe;
  expanded: boolean;
  isDeleting: boolean;
  isToggling: boolean;
  onToggleDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/70">
        <td className="px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">
            {recipe.product.name}
          </p>

          {recipe.name && (
            <p className="mt-1 text-xs text-slate-500">
              {recipe.name}
            </p>
          )}
        </td>

        <td className="px-5 py-4 text-sm text-slate-600">
          {recipe.items.length} malzeme
        </td>

        <td className="px-5 py-4 text-sm font-medium text-slate-800">
          {recipe.costPerUnit === null
            ? "Eksik maliyet"
            : formatMoney(Number(recipe.costPerUnit))}
        </td>

        <td className="px-5 py-4 text-sm text-slate-600">
          {formatMoney(Number(recipe.product.price))}
        </td>

        <td className="px-5 py-4">
          <button
            type="button"
            onClick={onToggleActive}
            disabled={isToggling || isDeleting}
            title="Aktif/pasif durumunu değiştir"
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
              recipe.isActive
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {isToggling && (
              <Loader2
                size={12}
                className="animate-spin"
              />
            )}
            {recipe.isActive ? "Aktif" : "Pasif"}
          </button>
        </td>

        <td className="px-5 py-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleDetails}
              title="Reçete detayları"
              className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
            >
              {expanded ? (
                <ChevronUp size={17} />
              ) : (
                <ChevronDown size={17} />
              )}
            </button>

            <button
              type="button"
              onClick={onEdit}
              title="Reçeteyi düzenle"
              className="rounded-lg p-2 text-amber-600 hover:bg-amber-50"
            >
              <Pencil size={17} />
            </button>

            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting || isToggling}
              title="Reçeteyi sil"
              className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {isDeleting ? (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              ) : (
                <Trash2 size={17} />
              )}
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/60">
          <td colSpan={6} className="px-5 py-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-800">
                  Reçete Malzemeleri
                </h4>

                <span className="text-xs text-slate-500">
                  Çıktı:{" "}
                  {numberFormatter.format(
                    Number(recipe.yieldQuantity)
                  )}{" "}
                  {unitLabels[recipe.product.unit]}
                </span>
              </div>

              <div className="space-y-3">
                {recipe.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"
                  >
                    <span className="font-medium text-slate-700">
                      {item.ingredient.name}
                    </span>

                    <div className="flex items-center gap-6">
                      <span className="text-slate-500">
                        {numberFormatter.format(
                          Number(item.quantity)
                        )}{" "}
                        {unitLabels[item.ingredient.unit]}
                      </span>

                      <span className="min-w-24 text-right font-medium text-slate-800">
                        {item.ingredient.costPrice === null
                          ? "Eksik maliyet"
                          : formatMoney(
                              Number(item.quantity) *
                                Number(
                                  item.ingredient.costPrice
                                )
                            )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 text-sm">
                <span className="font-semibold text-slate-800">
                  Birim Maliyet:{" "}
                  {recipe.costPerUnit === null
                    ? "Eksik maliyet"
                    : formatMoney(
                        Number(recipe.costPerUnit)
                      )}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
