
"use client";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";
import { useRef } from "react";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = {
  id: string;
  name: string;
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  costPrice: string | null;
};

type RecipeItem = {
  id: string;
  quantity: string;
  ingredient: Ingredient;
};

type Recipe = {
  id: string;
  name: string | null;
  yieldQuantity: string;
  product: {
    id: string;
    name: string;
    unit: string;
  };
  items: RecipeItem[];
};

type Stock = {
  branchId: string;
  productId: string;
  quantity: string;
};

type ProductionItem = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
};

type Production = {
  id: string;
  productName: string;
  recipeName: string | null;
  branchId: string;
  branch: Branch;
  quantity: string;
  totalCost: string;
  unitCost: string;
  note: string | null;
  createdAt: string;
  items: ProductionItem[];
};

type Props = {
  branches: Branch[];
  recipes: Recipe[];
  stocks: Stock[];
};

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(value);

const number = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 3,
  }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const unitLabel = (unit: string) => {
  const units: Record<string, string> = {
    PIECE: "adet",
    GRAM: "g",
    KILOGRAM: "kg",
    MILLILITER: "ml",
    LITER: "L",
  };

  return units[unit] ?? unit;
};

function formatError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Beklenmeyen bir hata oluştu.";
}

export default function ProductionManager({
  branches,
  recipes,
  stocks,
}: Props) {
  const requestAttempt = useRef<ClientAttempt | null>(null);
  const router = useRouter();

  const [branchId, setBranchId] = useState(
    branches[0]?.id ?? ""
  );
  const [recipeId, setRecipeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  const [productions, setProductions] = useState<
    Production[]
  >([]);

  const [loadingHistory, setLoadingHistory] =
    useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedId, setExpandedId] = useState<
    string | null
  >(null);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === recipeId),
    [recipes, recipeId]
  );

  const productionQuantity = Number(quantity);

  const requirements = useMemo(() => {
    if (
      !selectedRecipe ||
      !Number.isFinite(productionQuantity) ||
      productionQuantity <= 0
    ) {
      return [];
    }

    const yieldQuantity = Number(
      selectedRecipe.yieldQuantity
    );

    if (
      !Number.isFinite(yieldQuantity) ||
      yieldQuantity <= 0
    ) {
      return [];
    }

    const multiplier =
      productionQuantity / yieldQuantity;

    return selectedRecipe.items.map((item) => {
      const required =
        Math.ceil(
          (Number(item.quantity) * multiplier -
            1e-10) *
            1000
        ) / 1000;

      const stock = stocks.find(
        (stock) =>
          stock.branchId === branchId &&
          stock.productId === item.ingredient.id
      );

      const available = Number(stock?.quantity ?? 0);
      const unitCost =
        item.ingredient.costPrice === null
          ? null
          : Number(item.ingredient.costPrice);

      return {
        id: item.ingredient.id,
        name: item.ingredient.name,
        unit: item.ingredient.unit,
        required,
        available,
        unitCost,
        totalCost:
          unitCost === null
            ? null
            : required * unitCost,
        sufficient: available >= required,
      };
    });
  }, [
    selectedRecipe,
    productionQuantity,
    stocks,
    branchId,
  ]);

  const estimatedCost = requirements.reduce(
    (sum, item) => sum + (item.totalCost ?? 0),
    0
  );

  const missingCosts = requirements.some(
    (item) => item.unitCost === null
  );

  const insufficientStock = requirements.some(
    (item) => !item.sufficient
  );

  const validQuantity =
    Number.isFinite(productionQuantity) &&
    productionQuantity > 0 &&
    productionQuantity <= 1000000 &&
    /^\d+(\.\d{1,3})?$/.test(quantity);

  const canProduce =
    Boolean(branchId) &&
    Boolean(selectedRecipe) &&
    validQuantity &&
    requirements.length > 0 &&
    !missingCosts &&
    !insufficientStock &&
    !submitting;

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);

    try {
      const params = new URLSearchParams({
        limit: "50",
      });

      if (branchId) {
        params.set("branchId", branchId);
      }

      const response = await fetch(
        `/api/productions?${params.toString()}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Üretim geçmişi yüklenemedi."
        );
      }

      setProductions(data.productions ?? []);
    } catch (error) {
      setError(formatError(error));
    } finally {
      setLoadingHistory(false);
    }
  }, [branchId]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadHistory(); }, 0);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  async function handleProduce(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!canProduce) return;

    const confirmed = window.confirm(
      `${productionQuantity} ${unitLabel(
        selectedRecipe?.product.unit ?? "PIECE"
      )} ${
        selectedRecipe?.product.name ?? "ürün"
      } üretilecek. Stoklar güncellensin mi?`
    );

    if (!confirmed) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
          branchId,
          recipeId,
          quantity,
          note,
      };
      requestAttempt.current = clientAttempt(requestAttempt.current, payload, "production:" + branchId);
      const response = await fetch("/api/productions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, idempotencyKey: requestAttempt.current.key }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Üretim gerçekleştirilemedi."
        );
      }
      completeAttempt("production:" + branchId);
      requestAttempt.current = null;

      setSuccess(
        `${data.production.productName} üretimi tamamlandı.`
      );

      setNote("");
      setRecipeId("");
      setQuantity("1");

      await loadHistory();

      // Server Component'ten gelen stokları yeniler.
      router.refresh();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700"
        >
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <form
          onSubmit={handleProduce}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Yeni Üretim
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Reçete seçerek üretim işlemini başlatın.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="production-branch"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Şube
              </label>
              <select
                id="production-branch"
                className={inputClass}
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                required
              >
                <option value="">Şube seçin</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="production-recipe"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Üretilecek Ürün / Reçete
              </label>
              <select
                id="production-recipe"
                className={inputClass}
                value={recipeId}
                onChange={(event) => {
                  setRecipeId(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                required
              >
                <option value="">Reçete seçin</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.product.name}
                    {recipe.name
                      ? ` — ${recipe.name}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="production-quantity"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Üretim Miktarı
              </label>
              <input
                id="production-quantity"
                type="number"
                min="0.001"
                max="1000000"
                step="0.001"
                className={inputClass}
                value={quantity}
                onChange={(event) =>
                  setQuantity(event.target.value)
                }
                required
              />
            </div>

            <div>
              <label
                htmlFor="production-note"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Üretim Notu
              </label>
              <textarea
                id="production-note"
                rows={3}
                maxLength={500}
                className={inputClass}
                placeholder="İsteğe bağlı..."
                value={note}
                onChange={(event) =>
                  setNote(event.target.value)
                }
              />
            </div>

            <button
              type="submit"
              disabled={!canProduce}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Üretim Kaydediliyor..."
                : "Üretimi Tamamla"}
            </button>

            {branches.length === 0 && (
              <p className="text-sm text-amber-700">
                Üretim için önce şube oluşturmalısınız.
              </p>
            )}

            {recipes.length === 0 && (
              <p className="text-sm text-amber-700">
                Üretim için önce aktif bir reçete
                oluşturmalısınız.
              </p>
            )}
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            Üretim Önizlemesi
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Gerekli hammaddeler ve mevcut stok durumu.
          </p>

          {!selectedRecipe ? (
            <div className="flex min-h-64 items-center justify-center text-center text-sm text-gray-400">
              Önizleme için bir reçete seçin.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs text-gray-500">
                  Üretilecek ürün
                </p>
                <p className="mt-1 font-semibold text-gray-900">
                  {selectedRecipe.product.name}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Reçete çıktısı:{" "}
                  {number(
                    Number(selectedRecipe.yieldQuantity)
                  )}{" "}
                  {unitLabel(selectedRecipe.product.unit)}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="pb-3 font-medium">
                        Hammadde
                      </th>
                      <th className="pb-3 text-right font-medium">
                        Gerekli
                      </th>
                      <th className="pb-3 text-right font-medium">
                        Stok
                      </th>
                      <th className="pb-3 text-right font-medium">
                        Durum
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {requirements.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-gray-100"
                      >
                        <td className="py-3 text-gray-800">
                          {item.name}
                        </td>
                        <td className="py-3 text-right text-gray-700">
                          {number(item.required)}{" "}
                          {unitLabel(item.unit)}
                        </td>
                        <td className="py-3 text-right text-gray-700">
                          {number(item.available)}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={
                              item.sufficient
                                ? "font-medium text-green-600"
                                : "font-medium text-red-600"
                            }
                          >
                            {item.sufficient
                              ? "Yeterli"
                              : "Yetersiz"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {missingCosts && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                  Bazı hammaddelerin maliyet fiyatı
                  tanımlanmamış.
                </p>
              )}

              {insufficientStock && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Üretim için gerekli hammaddelerden
                  bazılarının stoğu yetersiz.
                </p>
              )}

              <div className="rounded-lg bg-blue-50 p-4">
                <p className="text-sm text-blue-700">
                  Tahmini Üretim Maliyeti
                </p>
                <p className="mt-1 text-2xl font-bold text-blue-900">
                  {missingCosts
                    ? "Hesaplanamıyor"
                    : money(estimatedCost)}
                </p>

                {!missingCosts &&
                  validQuantity && (
                    <p className="mt-1 text-sm text-blue-700">
                      Birim maliyet:{" "}
                      {money(
                        estimatedCost /
                          productionQuantity
                      )}
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Üretim Geçmişi
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Seçili şubenin son 50 üretim kaydı.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={loadingHistory}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Yenile
          </button>
        </div>

        {loadingHistory ? (
          <div className="py-12 text-center text-sm text-gray-500">
            Üretim kayıtları yükleniyor...
          </div>
        ) : productions.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            Henüz üretim kaydı bulunmuyor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="pb-3 font-medium">
                    Ürün
                  </th>
                  <th className="pb-3 font-medium">
                    Şube
                  </th>
                  <th className="pb-3 text-right font-medium">
                    Miktar
                  </th>
                  <th className="pb-3 text-right font-medium">
                    Maliyet
                  </th>
                  <th className="pb-3 text-right font-medium">
                    Tarih
                  </th>
                  <th className="pb-3 text-right font-medium">
                    Detay
                  </th>
                </tr>
              </thead>
              <tbody>
                {productions.map((production) => (
                  <FragmentRow
                    key={production.id}
                    production={production}
                    expanded={
                      expandedId === production.id
                    }
                    onToggle={() =>
                      setExpandedId(
                        expandedId === production.id
                          ? null
                          : production.id
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FragmentRow({
  production,
  expanded,
  onToggle,
}: {
  production: Production;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-100">
        <td className="py-3 font-medium text-gray-900">
          {production.productName}
        </td>
        <td className="py-3 text-gray-600">
          {production.branch.name}
        </td>
        <td className="py-3 text-right text-gray-700">
          {number(Number(production.quantity))}
        </td>
        <td className="py-3 text-right text-gray-700">
          {money(Number(production.totalCost))}
        </td>
        <td className="py-3 text-right text-gray-600">
          {dateTime(production.createdAt)}
        </td>
        <td className="py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="font-medium text-blue-600 hover:underline"
          >
            {expanded ? "Gizle" : "Göster"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="p-4">
            <div className="space-y-3">
              <div className="text-sm text-gray-600">
                <span className="font-medium">
                  Birim maliyet:
                </span>{" "}
                {money(Number(production.unitCost))}
              </div>

              {production.note && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">
                    Not:
                  </span>{" "}
                  {production.note}
                </p>
              )}

              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-800">
                  Tüketilen Hammaddeler
                </p>

                {production.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
                  >
                    <span className="text-gray-800">
                      {item.ingredientName}
                    </span>

                    <span className="text-gray-600">
                      {number(Number(item.quantity))}{" "}
                      {unitLabel(item.ingredientUnit)}
                    </span>

                    <span className="font-medium text-gray-900">
                      {money(Number(item.totalCost))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
