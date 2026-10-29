
"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  History,
  Search,
} from "lucide-react";

type MovementType =
  | "PURCHASE"
  | "SALE"
  | "RETURN"
  | "WASTE"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "PRODUCTION_IN"
  | "PRODUCTION_OUT";

type Movement = {
  id: string;
  type: MovementType;
  quantity: string;
  note: string | null;
  reference: string | null;
  createdAt: string;

  product: {
    id: string;
    name: string;
    sku: string | null;
  };

  branch: {
    id: string;
    name: string;
  };
};

type Props = {
  movements: Movement[];
};

const movementLabels: Record<MovementType, string> = {
  PURCHASE: "Mal Alımı",
  SALE: "Satış",
  RETURN: "İade",
  WASTE: "Fire",
  ADJUSTMENT_IN: "Stok Artırma",
  ADJUSTMENT_OUT: "Stok Azaltma",
  TRANSFER_IN: "Transfer Girişi",
  TRANSFER_OUT: "Transfer Çıkışı",
  PRODUCTION_IN: "Üretim Girişi",
  PRODUCTION_OUT: "Üretim Tüketimi",
};

function isIncoming(type: MovementType) {
  return (
    type === "PURCHASE" ||
    type === "RETURN" ||
    type === "ADJUSTMENT_IN" ||
    type === "TRANSFER_IN" ||
    type === "PRODUCTION_IN"
  );
}

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

export default function StockMovementList({
  movements,
}: Props) {
  const [search, setSearch] = useState("");
  const [copiedReference, setCopiedReference] =
    useState<string | null>(null);

  const filteredMovements = useMemo(() => {
    const value = search
      .trim()
      .toLocaleLowerCase("tr-TR");

    if (!value) {
      return movements;
    }

    return movements.filter((movement) => {
      const searchableFields = [
        movement.product.name,
        movement.product.sku,
        movement.branch.name,
        movement.note,
        movement.reference,
        movementLabels[movement.type],
      ];

      return searchableFields.some((field) =>
        (field ?? "")
          .toLocaleLowerCase("tr-TR")
          .includes(value)
      );
    });
  }, [movements, search]);

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopiedReference(reference);
    } catch (error) {
      console.error("REFERENCE_COPY_ERROR:", error);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Toolbar */}
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
            placeholder="Ürün, SKU, şube veya referans ara..."
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* Empty State */}
      {filteredMovements.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <History size={24} />
          </div>

          <h3 className="mt-4 font-semibold text-slate-800">
            {search
              ? "Aramanızla eşleşen stok hareketi bulunamadı"
              : "Stok hareketi bulunamadı"}
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            {search
              ? "Farklı bir arama terimi deneyebilirsiniz."
              : "Stok giriş ve çıkışları burada görüntülenecek."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Tarih
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Ürün
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Şube
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  İşlem
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Miktar
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Referans No
                </th>

                <th className="px-5 py-3 text-xs font-semibold uppercase text-slate-500">
                  Açıklama
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredMovements.map((movement) => {
                const incoming = isIncoming(
                  movement.type
                );

                const isTransfer =
                  movement.type === "TRANSFER_IN" ||
                  movement.type === "TRANSFER_OUT";

                const isCopied =
                  copiedReference === movement.reference &&
                  movement.reference !== null;

                return (
                  <tr
                    key={movement.id}
                    className="transition hover:bg-slate-50/70"
                  >
                    {/* Date */}
                    <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                      {dateFormatter.format(
                        new Date(movement.createdAt)
                      )}
                    </td>

                    {/* Product */}
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-slate-800">
                        {movement.product.name}
                      </p>

                      {movement.product.sku && (
                        <p className="mt-1 text-xs text-slate-400">
                          {movement.product.sku}
                        </p>
                      )}
                    </td>

                    {/* Branch */}
                    <td className="px-5 py-4 text-sm text-slate-500">
                      {movement.branch.name}
                    </td>

                    {/* Operation */}
                    <td className="px-5 py-4">
                      <span className="whitespace-nowrap text-sm font-medium text-slate-700">
                        {movementLabels[movement.type]}
                      </span>
                    </td>

                    {/* Quantity */}
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold ${
                          incoming
                            ? "text-emerald-600"
                            : "text-red-600"
                        }`}
                      >
                        {incoming ? (
                          <ArrowUp size={15} />
                        ) : (
                          <ArrowDown size={15} />
                        )}

                        {incoming ? "+" : "-"}
                        {movement.quantity}
                      </span>
                    </td>

                    {/* Reference */}
                    <td className="px-5 py-4">
                      {movement.reference ? (
                        <div className="flex items-center gap-2">
                          <span
                            title={movement.reference}
                            className={`block max-w-36 truncate rounded-lg px-2.5 py-1.5 font-mono text-xs font-medium ${
                              isTransfer
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {movement.reference}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              copyReference(
                                movement.reference!
                              )
                            }
                            title={
                              isCopied
                                ? "Kopyalandı"
                                : "Referansı kopyala"
                            }
                            aria-label="Referans numarasını kopyala"
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600"
                          >
                            {isCopied ? (
                              <Check
                                size={15}
                                className="text-emerald-600"
                              />
                            ) : (
                              <Copy size={15} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">
                          —
                        </span>
                      )}
                    </td>

                    {/* Note */}
                    <td className="max-w-xs px-5 py-4 text-sm text-slate-500">
                      {movement.note || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
