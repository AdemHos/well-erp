
"use client";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";
import { useRef } from "react";

import {
  type FormEvent,
  useMemo,
  useState,
} from "react";

import {
  AlertTriangle,
  ArrowRightLeft,
  Loader2,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";

import { useRouter } from "next/navigation";
import StockTransferModal from "./StockTransferModal";

type Product = {
  id: string;
  name: string;
  sku: string | null;
};

type Branch = {
  id: string;
  name: string;
};

type Stock = {
  id: string;
  quantity: string;
  criticalLevel: string;
  product: Product & {
    barcode?: string | null;
  };
  branch: Branch;
};

type Props = {
  initialStocks: Stock[];
  products: Product[];
  branches: Branch[];
  allBranches: Branch[];
};

export default function StockManager({
  initialStocks,
  products,
  branches,
  allBranches,
}: Props) {
  const requestAttempt = useRef<ClientAttempt | null>(null);
  const router = useRouter();

  const [stocks, setStocks] = useState<Stock[]>(
    initialStocks
  );

  const [search, setSearch] = useState("");

  const [isModalOpen, setIsModalOpen] =
    useState(false);

  const [
    isTransferModalOpen,
    setIsTransferModalOpen,
  ] = useState(false);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [error, setError] = useState("");

  const [productId, setProductId] =
    useState("");

  const [branchId, setBranchId] =
    useState(branches[0]?.id ?? "");

  const [quantity, setQuantity] =
    useState("");

  const [criticalLevel, setCriticalLevel] =
    useState("0");

  const [note, setNote] = useState("");

  const activeBranch = branches[0];

  const [previousStocks, setPreviousStocks] = useState(initialStocks);
  if (previousStocks !== initialStocks) {
    setPreviousStocks(initialStocks);
    setStocks(initialStocks);
  }

  const filteredStocks = useMemo(() => {
    const value = search
      .trim()
      .toLocaleLowerCase("tr-TR");

    return stocks.filter((stock) => {
      const productName = stock.product.name
        .toLocaleLowerCase("tr-TR");

      const sku = stock.product.sku
        ?.toLocaleLowerCase("tr-TR");

      const branchName = stock.branch.name
        .toLocaleLowerCase("tr-TR");

      return (
        productName.includes(value) ||
        Boolean(sku?.includes(value)) ||
        branchName.includes(value)
      );
    });
  }, [stocks, search]);

  async function editCriticalLevel(stock: Stock) {
    const next = window.prompt("Kritik stok seviyesi (en fazla 3 ondalık)", stock.criticalLevel);
    if (next === null) return;
    if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(next)) { setError("Geçerli kritik seviye girin."); return; }
    try {
      const response = await fetch("/api/stock", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId: stock.branch.id, productId: stock.product.id, criticalLevel: next }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setStocks(current => current.map(row => row.id === stock.id ? { ...row, criticalLevel: next } : row)); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Kritik seviye kaydedilemedi."); }
  }
  const totalProducts = stocks.length;

  const criticalStocks = useMemo(() => {
    return stocks.filter((stock) => {
      const currentQuantity = Number(
        stock.quantity
      );

      const criticalQuantity = Number(
        stock.criticalLevel
      );

      return (
        
        currentQuantity <= criticalQuantity
      );
    }).length;
  }, [stocks]);

  function resetForm() {
    setProductId("");
    setBranchId(activeBranch?.id ?? "");
    setQuantity("");
    setCriticalLevel("0");
    setNote("");
    setError("");
  }

  function openModal() {
    resetForm();
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSubmitting) return;

    setIsModalOpen(false);
    resetForm();
  }

  function openTransferModal() {
    if (
      !activeBranch ||
      allBranches.filter(
        (branch) => branch.id !== activeBranch.id
      ).length === 0
    ) {
      return;
    }

    setIsTransferModalOpen(true);
  }

  function closeTransferModal() {
    setIsTransferModalOpen(false);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!productId) {
      setError("Ürün seçmelisiniz.");
      return;
    }

    if (!branchId) {
      setError("Şube seçmelisiniz.");
      return;
    }

    const amount = Number(quantity);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !/^\d+(\.\d{1,3})?$/.test(quantity)
    ) {
      setError(
        "Geçerli bir stok miktarı giriniz. En fazla 3 ondalık basamak kullanabilirsiniz."
      );
      return;
    }

    const critical = Number(criticalLevel);

    if (
      !Number.isFinite(critical) ||
      critical < 0
    ) {
      setError(
        "Kritik stok seviyesi geçersiz."
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const payload = {
            productId,
            branchId,
            quantity,
            criticalLevel,
            note,
      };
      requestAttempt.current = clientAttempt(requestAttempt.current, payload, "stock-receive:" + branchId);
      const response = await fetch(
        "/api/stock",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...payload, idempotencyKey: requestAttempt.current.key }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "Stok girişi yapılamadı."
        );
        return;
      }
      completeAttempt("stock-receive:" + branchId);
      requestAttempt.current = null;

      if (data.stock) {
        const returnedStock: Stock = {
          ...data.stock,
          quantity: String(
            data.stock.quantity
          ),
          criticalLevel: String(
            data.stock.criticalLevel
          ),
        };

        setStocks((current) => {
          const exists = current.some(
            (stock) =>
              stock.id === returnedStock.id
          );

          if (exists) {
            return current.map((stock) =>
              stock.id === returnedStock.id
                ? returnedStock
                : stock
            );
          }

          return [
            returnedStock,
            ...current,
          ];
        });
      }

      // Modalı doğrudan kapatıyoruz.
      // closeModal() isSubmitting=true
      // olduğunda kapanmayı engelliyordu.
      setIsModalOpen(false);
      resetForm();

      router.refresh();
    } catch (error) {
      console.error(
        "STOCK_CREATE_ERROR:",
        error
      );

      setError(
        "Sunucuya bağlanırken bir hata oluştu."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Stok Kaydı
                </p>

                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {totalProducts}
                </p>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Package size={22} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Kritik Stok
                </p>

                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {criticalStocks}
                </p>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <AlertTriangle size={22} />
              </div>
            </div>
          </div>
        </div>

        {/* Stock Table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Toolbar */}
          <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Ürün, SKU veya şube ara..."
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openTransferModal}
                disabled={
                  !activeBranch ||
                  allBranches.filter(
                    (branch) =>
                      branch.id !==
                      activeBranch.id
                  ).length === 0
                }
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowRightLeft size={17} />
                Stok Transferi
              </button>

              <button
                type="button"
                onClick={openModal}
                disabled={!activeBranch}
                className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus size={17} />
                Stok Girişi
              </button>
            </div>
          </div>

          {/* Table Content */}
          {filteredStocks.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Package size={25} />
              </div>

              <h3 className="mt-4 font-semibold text-slate-800">
                {search
                  ? "Aramanızla eşleşen stok bulunamadı"
                  : "Henüz stok kaydı bulunmuyor"}
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                {search
                  ? "Farklı bir ürün veya SKU ile arama yapabilirsiniz."
                  : "İlk stok girişinizi yaparak başlayabilirsiniz."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left">
                    <th className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                      Ürün
                    </th>

                    <th className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                      Şube
                    </th>

                    <th className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                      Mevcut Stok
                    </th>

                    <th className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                      Kritik Seviye
                    </th>

                    <th className="px-6 py-3 text-xs font-semibold uppercase text-slate-500">
                      Durum
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredStocks.map(
                    (stock) => {
                      const currentQuantity =
                        Number(
                          stock.quantity
                        );

                      const criticalQuantity =
                        Number(
                          stock.criticalLevel
                        );

                      const isCritical =
                        criticalQuantity > 0 &&
                        currentQuantity <=
                          criticalQuantity;

                      return (
                        <tr
                          key={stock.id}
                          className="transition hover:bg-slate-50/70"
                        >
                          <td className="px-6 py-4">
                            <p className="text-sm font-semibold text-slate-800">
                              {
                                stock.product
                                  .name
                              }
                            </p>

                            {stock.product
                              .sku && (
                              <p className="mt-1 text-xs text-slate-400">
                                {
                                  stock.product
                                    .sku
                                }
                              </p>
                            )}
                          </td>

                          <td className="px-6 py-4 text-sm text-slate-500">
                            {
                              stock.branch
                                .name
                            }
                          </td>

                          <td className="px-6 py-4 text-sm font-semibold text-slate-800">
                            {stock.quantity}
                          </td>

                          <td className="px-6 py-4 text-sm text-slate-500">
                            {
                              stock.criticalLevel
                            }
                            <button type="button" className="ml-2 text-xs text-blue-600 underline" disabled={isSubmitting} onClick={() => void editCriticalLevel(stock)}>Düzenle</button>
                          </td>

                          <td className="px-6 py-4">
                            {isCritical ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
                                <AlertTriangle
                                  size={13}
                                />
                                Kritik
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                                Normal
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Stock Entry Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-entry-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="stock-entry-title"
                  className="font-semibold text-slate-950"
                >
                  Stok Girişi
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Aktif şubeye yeni ürün stoğu ekleyin.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                aria-label="Kapat"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-6"
            >
              <div className="space-y-5">
                {/* Product */}
                <div>
                  <label
                    htmlFor="stock-product"
                    className="text-sm font-medium text-slate-700"
                  >
                    Ürün *
                  </label>

                  <select
                    id="stock-product"
                    required
                    value={productId}
                    onChange={(event) =>
                      setProductId(
                        event.target.value
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="">
                      Ürün seçin
                    </option>

                    {products.map(
                      (product) => (
                        <option
                          key={product.id}
                          value={product.id}
                        >
                          {product.name}
                          {product.sku
                            ? ` (${product.sku})`
                            : ""}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Branch */}
                <div>
                  <label
                    htmlFor="stock-branch"
                    className="text-sm font-medium text-slate-700"
                  >
                    Şube *
                  </label>

                  <select
                    id="stock-branch"
                    required
                    value={branchId}
                    onChange={(event) =>
                      setBranchId(
                        event.target.value
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="">
                      Şube seçin
                    </option>

                    {branches.map(
                      (branch) => (
                        <option
                          key={branch.id}
                          value={branch.id}
                        >
                          {branch.name}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Quantity */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="stock-quantity"
                      className="text-sm font-medium text-slate-700"
                    >
                      Miktar *
                    </label>

                    <input
                      id="stock-quantity"
                      required
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(
                          event.target.value
                        )
                      }
                      placeholder="50"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="stock-critical"
                      className="text-sm font-medium text-slate-700"
                    >
                      Kritik Seviye
                    </label>

                    <input
                      id="stock-critical"
                      type="number"
                      min="0"
                      step="0.001"
                      value={criticalLevel}
                      onChange={(event) =>
                        setCriticalLevel(
                          event.target.value
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Note */}
                <div>
                  <label
                    htmlFor="stock-note"
                    className="text-sm font-medium text-slate-700"
                  >
                    Açıklama
                  </label>

                  <textarea
                    id="stock-note"
                    rows={3}
                    value={note}
                    onChange={(event) =>
                      setNote(
                        event.target.value
                      )
                    }
                    placeholder="Örn. Haftalık tedarik teslimatı"
                    className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600"
                >
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50"
                >
                  İptal
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex min-w-28 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  )}

                  Stok Ekle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Transfer Modal */}
      {isTransferModalOpen &&
        activeBranch && (
          <StockTransferModal
            products={products}
            branches={allBranches}
            activeBranchId={
              activeBranch.id
            }
            onClose={
              closeTransferModal
            }
          />
        )}
    </>
  );
}
