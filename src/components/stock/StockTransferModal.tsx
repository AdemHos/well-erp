
"use client";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";
import { useRef } from "react";

import { FormEvent, useState } from "react";
import {
  ArrowRightLeft,
  Loader2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

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
  activeBranchId: string;
  onClose: () => void;
};

export default function StockTransferModal({
  products,
  branches,
  activeBranchId,
  onClose,
}: Props) {
  const requestAttempt = useRef<ClientAttempt | null>(null);
  const router = useRouter();

  const [productId, setProductId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [error, setError] = useState("");

  const fromBranch = branches.find(
    (branch) => branch.id === activeBranchId
  );

  const destinationBranches = branches.filter(
    (branch) => branch.id !== activeBranchId
  );

  function handleClose() {
    if (isSubmitting) return;
    onClose();
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setError("");

    if (!fromBranch) {
      setError("Aktif şube bulunamadı.");
      return;
    }

    if (!productId) {
      setError("Transfer edilecek ürünü seçiniz.");
      return;
    }

    if (!toBranchId) {
      setError("Hedef şubeyi seçiniz.");
      return;
    }

    if (toBranchId === activeBranchId) {
      setError(
        "Kaynak ve hedef şube aynı olamaz."
      );
      return;
    }

    const amount = Number(quantity);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !/^\d+(\.\d{1,3})?$/.test(quantity)
    ) {
      setError(
        "Geçerli bir transfer miktarı giriniz. En fazla 3 ondalık basamak kullanabilirsiniz."
      );
      return;
    }

    try {
      setIsSubmitting(true);

      const payload = {
            productId,
            fromBranchId: activeBranchId,
            toBranchId,
            quantity,
            note,
      };
      requestAttempt.current = clientAttempt(requestAttempt.current, payload, "stock-transfer:" + activeBranchId);
      const response = await fetch(
        "/api/stock/transfers",
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
            "Stok transferi gerçekleştirilemedi."
        );
        return;
      }
      completeAttempt("stock-transfer:" + activeBranchId);
      requestAttempt.current = null;

      onClose();
      router.refresh();
    } catch (error) {
      console.error(
        "STOCK_TRANSFER_ERROR:",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <ArrowRightLeft
                size={20}
                className="text-blue-600"
              />

              <h2
                id="transfer-modal-title"
                className="text-lg font-semibold text-slate-950"
              >
                Şubeler Arası Stok Transferi
              </h2>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Aktif şubeden başka bir şubeye ürün gönderin.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Kapat"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 p-6"
        >
          {/* Source Branch */}
          <div>
            <label className="text-sm font-medium text-slate-700">
              Kaynak Şube
            </label>

            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {fromBranch?.name ||
                "Aktif şube bulunamadı"}
            </div>
          </div>

          {/* Destination Branch */}
          <div>
            <label
              htmlFor="transfer-target"
              className="text-sm font-medium text-slate-700"
            >
              Hedef Şube *
            </label>

            <select
              id="transfer-target"
              required
              value={toBranchId}
              onChange={(event) =>
                setToBranchId(event.target.value)
              }
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="">
                Hedef şube seçin
              </option>

              {destinationBranches.map(
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

          {/* Product */}
          <div>
            <label
              htmlFor="transfer-product"
              className="text-sm font-medium text-slate-700"
            >
              Ürün *
            </label>

            <select
              id="transfer-product"
              required
              value={productId}
              onChange={(event) =>
                setProductId(event.target.value)
              }
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
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

          {/* Quantity */}
          <div>
            <label
              htmlFor="transfer-quantity"
              className="text-sm font-medium text-slate-700"
            >
              Transfer Miktarı *
            </label>

            <input
              id="transfer-quantity"
              type="number"
              min="0.001"
              step="0.001"
              required
              value={quantity}
              onChange={(event) =>
                setQuantity(event.target.value)
              }
              placeholder="Örn. 25"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
          </div>

          {/* Note */}
          <div>
            <label
              htmlFor="transfer-note"
              className="text-sm font-medium text-slate-700"
            >
              Açıklama
            </label>

            <textarea
              id="transfer-note"
              rows={3}
              value={note}
              onChange={(event) =>
                setNote(event.target.value)
              }
              placeholder="Örn. Diğer şubenin stok ihtiyacı"
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
            />
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600"
            >
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50"
            >
              İptal
            </button>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                !fromBranch ||
                destinationBranches.length === 0
              }
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2
                  size={16}
                  className="animate-spin"
                />
              ) : (
                <ArrowRightLeft size={16} />
              )}

              {isSubmitting
                ? "Transfer Ediliyor..."
                : "Transferi Tamamla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
