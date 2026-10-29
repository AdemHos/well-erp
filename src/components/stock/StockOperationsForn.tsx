"use client";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";
import { useRef } from "react";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string | null;
};

type Branch = {
  id: string;
  name: string;
};

type Props = {
  products: Product[];
  branches: Branch[];
};

type OperationType =
  | "WASTE"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT";

export default function StockOperationForm({
  products,
  branches,
}: Props) {
  const requestAttempt = useRef<ClientAttempt | null>(null);
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState(
    branches[0]?.id || ""
  );

  const [type, setType] =
    useState<OperationType>("WASTE");

  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  function resetForm() {
    setProductId("");
    setBranchId(branches[0]?.id || "");
    setType("WASTE");
    setQuantity("");
    setNote("");
    setError("");
  }

  function openModal() {
    resetForm();
    setIsOpen(true);
  }

  function closeModal() {
    if (loading) return;

    setIsOpen(false);
    resetForm();
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (!productId) {
      setError("Ürün seçmelisiniz.");
      return;
    }

    if (!branchId) {
      setError("Şube seçmelisiniz.");
      return;
    }

    if (!quantity || Number(quantity) <= 0) {
      setError("Geçerli bir miktar giriniz.");
      return;
    }

    try {
      setLoading(true);

      const payload = {
            productId,
            branchId,
            type,
            quantity,
            note,
      };
      requestAttempt.current = clientAttempt(requestAttempt.current, payload, "stock-adjust:" + branchId);
      const response = await fetch(
        "/api/stock/movements",
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
            "Stok işlemi gerçekleştirilemedi."
        );

        return;
      }
      completeAttempt("stock-adjust:" + branchId);
      requestAttempt.current = null;

      setIsOpen(false);
      resetForm();

      // Mevcut stok ve hareket geçmişini
      // server'dan tekrar getir.
      router.refresh();
    } catch (error) {
      console.error(
        "STOCK_OPERATION_ERROR:",
        error
      );

      setError(
        "Sunucuya bağlanırken bir hata oluştu."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Open Modal Button */}
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        <SlidersHorizontal size={17} />
        Stok İşlemi
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">

            {/* ==================================================
                MODAL HEADER
            ================================================== */}

            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="font-semibold text-slate-950">
                  Stok İşlemi
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Fire veya manuel stok düzeltmesi
                  gerçekleştirin.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Kapat"
              >
                <X size={18} />
              </button>
            </div>

            {/* ==================================================
                FORM
            ================================================== */}

            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* Scrollable Content */}

              <div className="flex-1 overflow-y-auto p-6">
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
                      value={productId}
                      onChange={(event) => {
                        setProductId(
                          event.target.value
                        );

                        if (error) {
                          setError("");
                        }
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    >
                      <option value="">
                        Ürün seçin
                      </option>

                      {products.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                        >
                          {product.name}
                          {product.sku
                            ? ` (${product.sku})`
                            : ""}
                        </option>
                      ))}
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
                      value={branchId}
                      onChange={(event) => {
                        setBranchId(
                          event.target.value
                        );

                        if (error) {
                          setError("");
                        }
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    >
                      <option value="">
                        Şube seçin
                      </option>

                      {branches.map((branch) => (
                        <option
                          key={branch.id}
                          value={branch.id}
                        >
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Operation Type */}

                  <div>
                    <label
                      htmlFor="stock-operation"
                      className="text-sm font-medium text-slate-700"
                    >
                      İşlem *
                    </label>

                    <select
                      id="stock-operation"
                      value={type}
                      onChange={(event) =>
                        setType(
                          event.target
                            .value as OperationType
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    >
                      <option value="WASTE">
                        Fire / Zayi
                      </option>

                      <option value="ADJUSTMENT_IN">
                        Manuel Stok Artırma
                      </option>

                      <option value="ADJUSTMENT_OUT">
                        Manuel Stok Azaltma
                      </option>
                    </select>
                  </div>

                  {/* Quantity */}

                  <div>
                    <label
                      htmlFor="stock-quantity"
                      className="text-sm font-medium text-slate-700"
                    >
                      Miktar *
                    </label>

                    <input
                      id="stock-quantity"
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={quantity}
                      onChange={(event) => {
                        setQuantity(
                          event.target.value
                        );

                        if (error) {
                          setError("");
                        }
                      }}
                      placeholder="Örn: 5"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    />
                  </div>

                  {/* Stock Decrease Warning */}

                  {(type === "WASTE" ||
                    type ===
                      "ADJUSTMENT_OUT") && (
                    <div className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <AlertTriangle
                        size={18}
                        className="mt-0.5 shrink-0 text-amber-600"
                      />

                      <p className="text-sm leading-5 text-amber-700">
                        Bu işlem mevcut stok
                        miktarını azaltacaktır.
                      </p>
                    </div>
                  )}

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
                        setNote(event.target.value)
                      }
                      placeholder={
                        type === "WASTE"
                          ? "Örn: Son kullanma tarihi geçti"
                          : "İşlem açıklaması"
                      }
                      className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    />
                  </div>

                  {/* Error */}

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
                    >
                      {error}
                    </div>
                  )}
                </div>
              </div>

              {/* ==================================================
                  FIXED FOOTER
              ================================================== */}

              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={loading}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  İptal
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-w-32 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading && (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  )}

                  {loading
                    ? "Kaydediliyor..."
                    : "İşlemi Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}