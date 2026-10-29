
"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  Package,
  Search,
} from "lucide-react";

type Transfer = {
  reference: string;
  productId: string;
  productName: string;
  fromBranch: string;
  toBranch: string;
  quantity: string;
  createdAt: string;
  note: string | null;
};

type Props = {
  transfers: Transfer[];
  activeBranchId: string;
  branches: {
    id: string;
    name: string;
  }[];
};

export default function StockTransferHistory({
  transfers,
  activeBranchId,
  branches,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "ALL" | "OUT" | "IN"
  >("ALL");

  const activeBranch = branches.find(
    (branch) => branch.id === activeBranchId
  );

  const filteredTransfers = useMemo(() => {
    const query = search
      .trim()
      .toLocaleLowerCase("tr-TR");

    return transfers.filter((transfer) => {
      const matchesSearch = [
        transfer.reference,
        transfer.productName,
        transfer.fromBranch,
        transfer.toBranch,
      ].some((value) =>
        value.toLocaleLowerCase("tr-TR").includes(query)
      );

      if (!matchesSearch) return false;

      if (filter === "ALL") return true;

      if (filter === "OUT") {
        return transfer.fromBranch === activeBranch?.name;
      }

      return transfer.toBranch === activeBranch?.name;
    });
  }, [transfers, search, filter, activeBranch?.name]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ürün, şube veya referans ara..."
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex gap-2">
          {(
            [
              ["ALL", "Tümü"],
              ["OUT", "Gönderilen"],
              ["IN", "Alınan"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                filter === value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filteredTransfers.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
          <Package size={28} className="text-slate-400" />
          <h3 className="mt-3 font-semibold text-slate-800">
            Transfer kaydı bulunamadı
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Transfer işlemleri burada listelenecek.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Ürün</th>
                <th className="px-5 py-3">Transfer</th>
                <th className="px-5 py-3">Miktar</th>
                <th className="px-5 py-3">Tarih</th>
                <th className="px-5 py-3">Referans</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransfers.map((transfer) => (
                <tr
                  key={`${transfer.reference}-${transfer.productId}`}
                  className="hover:bg-slate-50"
                >
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold text-slate-800">
                      {transfer.productName}
                    </p>
                    {transfer.note && (
                      <p className="mt-1 max-w-xs truncate text-xs text-slate-400">
                        {transfer.note}
                      </p>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <span>{transfer.fromBranch}</span>
                      <ArrowRightLeft
                        size={15}
                        className="shrink-0 text-blue-500"
                      />
                      <span>{transfer.toBranch}</span>
                    </div>
                  </td>

                  <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                    {transfer.quantity}
                  </td>

                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <CalendarDays size={14} />
                      {new Date(transfer.createdAt).toLocaleString(
                        "tr-TR",
                        { timeZone: "Europe/Istanbul" }
                      )}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <span
                      title={transfer.reference}
                      className="block max-w-40 truncate font-mono text-xs text-slate-500"
                    >
                      {transfer.reference}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
