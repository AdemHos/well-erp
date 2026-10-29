
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Banknote,
  ChevronRight,
  CreditCard,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

import SaleReceipt, { type ReceiptOrder } from "@/components/pos/SaleReceipt";

type OrderStatus = "COMPLETED" | "CANCELLED" | "REFUNDED";


type Order = ReceiptOrder & { status: OrderStatus; note: string | null; branch: { id: string; name: string } };

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

function statusLabel(status: OrderStatus) {
  switch (status) {
    case "COMPLETED":
      return "Tamamlandı";
    case "CANCELLED":
      return "İptal Edildi";
    case "REFUNDED":
      return "İade Edildi";
  }
}

function statusClass(status: OrderStatus) {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-50 text-emerald-700";
    case "CANCELLED":
      return "bg-red-50 text-red-700";
    case "REFUNDED":
      return "bg-amber-50 text-amber-700";
  }
}

export default function OrderManager({ canRefund }: { canRefund: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ count: 0, total: "0", cash: "0", card: "0" });
  const requestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const refundInFlight = useRef(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState("ALL");

  const [selectedOrder, setSelectedOrder] =
    useState<Order | null>(null);

  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [showRefundConfirm, setShowRefundConfirm] =
    useState(false);

  const fetchOrders = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams({ page: String(page), limit: "25", search, startDate, endDate });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (paymentFilter !== "ALL") params.set("paymentMethod", paymentFilter);
      const response = await fetch("/api/orders?" + params, { cache: "no-store", signal });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Satışlar alınamadı."
        );
      }

      if (version !== requestVersion.current || signal?.aborted) return;
      if (page > Math.max(1, data.totalPages ?? 0)) {
        setPage(Math.max(1, data.totalPages ?? 0));
        return;
      }
      setOrders(data.orders ?? []);
      setTotalPages(data.totalPages ?? 0);
      setTotal(data.total ?? 0);
      setSummary(data.summary ?? { count: 0, total: "0", cash: "0", card: "0" });
    } catch (err) {
      if (version !== requestVersion.current || signal?.aborted) return;
      setOrders([]);
      setTotal(0);
      setTotalPages(0);
      setSummary({ count: 0, total: "0", cash: "0", card: "0" });
      setError(
        err instanceof Error
          ? err.message
          : "Satışlar yüklenirken bir hata oluştu."
      );
    } finally {
      if (version === requestVersion.current && !signal?.aborted) setLoading(false);
    }
  }, [page, search, startDate, endDate, statusFilter, paymentFilter]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void fetchOrders(controller.signal); });
    return () => controller.abort();
  }, [fetchOrders]);
  const filteredOrders = orders;
  const totalRevenue = summary.total;
  const cashRevenue = summary.cash;
  const cardRevenue = summary.card;

  async function openOrderDetails(order: Order) {
    setRefundReason("");
    const version = ++detailRequestVersion.current;
    setRefundError("");
    setShowRefundConfirm(false);
    setSelectedOrder(order);
    try {
      const response = await fetch(`/api/orders/${order.id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Satış detayı alınamadı.");
      if (version !== detailRequestVersion.current) return;
      setSelectedOrder((current) => current?.id === order.id && !refundInFlight.current ? data.order : current);
    } catch {
      if (version === detailRequestVersion.current) setRefundError("Güncel satış detayı alınamadı. İade öncesinde satışın durumunu yenileyin.");
    }
  }

  function closeOrderDetails() {
    if (refunding) return;
    detailRequestVersion.current++;

    setSelectedOrder(null);
    setRefundError("");
    setShowRefundConfirm(false);
  }

  async function refundOrder() {
    if (
      !canRefund || refundInFlight.current || !selectedOrder ||
      selectedOrder.status !== "COMPLETED" ||
      refunding
    ) {
      return;
    }

    const orderId = selectedOrder.id;
    detailRequestVersion.current++;
    refundInFlight.current = true;

    try {
      setRefunding(true);
      setRefundError("");

      const response = await fetch(
        `/api/orders/${orderId}/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "REFUNDED",
            reason: refundReason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setRefundError(data.error || "İade tamamlanamadı.");
        if (response.status === 409) {
          const detail = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
          if (detail.ok) setSelectedOrder((await detail.json()).order);
          await fetchOrders();
        }
        return;
      }

      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: "CANCELLED",
              }
            : order
        )
      );

      setSelectedOrder(data.order);
      setShowRefundConfirm(false);
      setSuccess(data.message ?? "Tam iade tamamlandı.");

      await fetchOrders();
    } catch {
      setRefundError("İade sonucu doğrulanamadı. Tekrar denemeden önce satışın durumunu yenileyin.");
    } finally {
      refundInFlight.current = false;
      setRefunding(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">
            Satışlar
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            POS üzerinden gerçekleştirilen satışları
            görüntüleyin.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchOrders()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : ""}
          />
          Yenile
        </button>
      </div>

      {/* STATISTICS */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Tamamlanan Satış"
          value={String(summary.count)}
          icon={<ShoppingBag size={20} />}
        />

        <StatCard
          title="Toplam Satış Tutarı"
          value={formatCurrency(totalRevenue)}
          icon={<ReceiptText size={20} />}
        />

        <StatCard
          title="Nakit Satış"
          value={formatCurrency(cashRevenue)}
          icon={<Banknote size={20} />}
        />

        <StatCard
          title="Kart Satış"
          value={formatCurrency(cardRevenue)}
          icon={<CreditCard size={20} />}
        />
      </div>

      <p className="text-xs text-slate-400">
        İstatistikler aktif şubenin seçili filtrelere uyan tüm satışları üzerinden hesaplanır.
        İptal ve iade edilmiş satışlar toplamlara dahil
        edilmez.
      </p>

      {success && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
      <p className="text-xs text-slate-500">Tamamlanmış satışlar yalnızca tam iade ile geri alınır. İptal durumu ödemesi alınmamış işlemler içindir; durum değiştirerek iptal yapılamaz.</p>
      {/* FILTERS */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              type="text"
              value={search}
              onChange={(event) =>
                { setSearch(event.target.value); setPage(1); }
              }
              placeholder="Sipariş no, şube veya ürün ara..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) =>
              { setStatusFilter(event.target.value); setPage(1); }
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500"
          >
            <option value="ALL">Tüm Durumlar</option>
            <option value="COMPLETED">Tamamlandı</option>
            <option value="CANCELLED">İptal Edildi</option>
            <option value="REFUNDED">İade Edildi</option>
          </select>

          <select
            value={paymentFilter}
            onChange={(event) =>
              { setPaymentFilter(event.target.value); setPage(1); }
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500"
          >
            <option value="ALL">Tüm Ödemeler</option>
            <option value="CASH">Nakit</option>
            <option value="CARD">Kart</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm text-slate-600">Başlangıç tarihi (İstanbul)<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
        <label className="text-sm text-slate-600">Bitiş tarihi (dahil)<input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 p-2" /></label>
      </div>
      {/* ORDERS TABLE */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">
            Satış Geçmişi
          </h2>

          <span className="text-xs text-slate-500">
            {filteredOrders.length} kayıt
          </span>
        </div>

        {error ? (
          <div className="p-10 text-center">
            <p className="text-sm text-red-600">
              {error}
            </p>

            <button
              type="button"
              onClick={() => void fetchOrders()}
              className="mt-3 text-sm font-medium text-blue-600"
            >
              Tekrar Dene
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2
              size={20}
              className="animate-spin"
            />
            Satışlar yükleniyor...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <ReceiptText
              size={36}
              className="mx-auto text-slate-300"
            />

            <p className="mt-3 font-medium text-slate-700">
              Satış bulunamadı
            </p>

            <p className="mt-1 text-sm text-slate-400">
              Henüz satış yapılmamış veya filtrelere
              uygun kayıt yok.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-slate-50">
                <tr className="text-xs font-semibold text-slate-500">
                  <th className="px-5 py-4">
                    Sipariş No
                  </th>
                  <th className="px-5 py-4">
                    Tarih
                  </th>
                  <th className="px-5 py-4">
                    Şube
                  </th>
                  <th className="px-5 py-4">
                    Ödeme
                  </th>
                  <th className="px-5 py-4">
                    Durum
                  </th>
                  <th className="px-5 py-4 text-right">Ara Toplam</th>
                  <th className="px-5 py-4 text-right">İndirim</th>
                  <th className="px-5 py-4 text-right">
                    Net Toplam
                  </th>
                  <th className="px-5 py-4 text-right">
                    İşlem
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="transition hover:bg-slate-50"
                  >
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      {order.orderNumber}
                    </td>

                    <td className="px-5 py-4 text-sm text-slate-600">
                      {formatDate(order.createdAt)}
                    </td>

                    <td className="px-5 py-4 text-sm text-slate-600">
                      {order.branch.name}
                    </td>

                    <td className="px-5 py-4 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-2">
                        {order.paymentMethod === "CASH" ? (
                          <Banknote size={16} />
                        ) : (
                          <CreditCard size={16} />
                        )}

                        {order.paymentMethod === "CASH"
                          ? "Nakit"
                          : "Kart"}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${statusClass(
                          order.status
                        )}`}
                      >
                        {statusLabel(order.status)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right text-sm">{formatCurrency(order.subtotal)}</td>
                    <td className="px-5 py-4 text-right text-sm">{formatCurrency(order.discountAmount)}</td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-slate-900">
                      {formatCurrency(order.total)}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          openOrderDetails(order)
                        }
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 transition hover:text-blue-700"
                      >
                        Detay
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <nav aria-label="Satış sayfaları" className="flex items-center justify-between gap-3 text-sm text-slate-600">
        <button type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">Önceki</button>
        <span>{total} satış · Sayfa {page} / {Math.max(totalPages, 1)}</span>
        <button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">Sonraki</button>
      </nav>
      {/* ORDER DETAILS MODAL */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            {/* MODAL HEADER */}
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <h2
                  id="order-detail-title"
                  className="text-lg font-bold text-slate-950"
                >
                  Sipariş Detayı
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {selectedOrder.orderNumber}
                </p>
              </div>

              <button
                type="button"
                onClick={closeOrderDetails}
                disabled={refunding}
                aria-label="Kapat"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            {/* MODAL CONTENT */}
            <div className="space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4">
                <DetailField
                  label="Tarih"
                  value={formatDate(
                    selectedOrder.createdAt
                  )}
                />

                <DetailField
                  label="Şube"
                  value={selectedOrder.branch.name}
                />

                <DetailField
                  label="Ödeme"
                  value={
                    selectedOrder.paymentMethod === "CASH"
                      ? "Nakit"
                      : "Kart"
                  }
                />

                <DetailField
                  label="Durum"
                  value={statusLabel(
                    selectedOrder.status
                  )}
                />
              </div>

              {/* ORDER ITEMS */}
              <div>
                <h3 className="mb-3 font-semibold text-slate-900">
                  Satılan Ürünler
                </h3>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 p-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {item.productName}
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          {Number(item.quantity).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} ×{" "}
                          {formatCurrency(
                            item.unitPrice
                          )}
                        </p>
                      </div>

                      <span className="shrink-0 text-sm font-semibold text-slate-900">
                        {formatCurrency(item.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* NOTE */}
              {selectedOrder.note && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">
                    Not
                  </p>

                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    {selectedOrder.note}
                  </p>
                </div>
              )}

              <div className="flex justify-between text-sm"><span>Ara toplam</span><span>{formatCurrency(selectedOrder.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span>İndirim {selectedOrder.discountType === "PERCENT" ? "(%" + Number(selectedOrder.discountValue) + ")" : selectedOrder.discountType === "FIXED" ? "(Sabit tutar)" : ""}</span><span>{formatCurrency(selectedOrder.discountAmount)}</span></div>
              <SaleReceipt order={selectedOrder} title="Satış fişini yeniden yazdır" showRetentionHint={false} />
              {/* TOTAL */}
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-600">
                    Toplam Tutar
                  </span>

                  <span className="text-xl font-bold text-slate-950">
                    {formatCurrency(
                      selectedOrder.total
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* MODAL FOOTER */}
            <div className="border-t border-slate-100 p-5">
              {refundError && (
                <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                  {refundError}
                </p>
              )}

              {showRefundConfirm &&
              selectedOrder.status === "COMPLETED" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-800">
                    Bu satışın tamamını iade etmek istediğinize
                    emin misiniz?
                  </p>

                  <p className="text-xs text-slate-500">
                    {Number(selectedOrder.total) === 0
                      ? "Ürünler satışın şubesine geri eklenecek; sıfır tutarlı satış için finans hareketi oluşturulmayacak."
                      : "Ürünler satışın şubesine geri eklenecek; net tutar ilk finans hesabından çıkış kaydedilecek. Bankadan otomatik kart iadesi yapılmaz."} Bu işlem geri alınamaz.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    <label className="w-full text-sm">İade açıklaması<input aria-label="İade açıklaması" className="mt-1 w-full rounded-lg border p-2" maxLength={500} value={refundReason} disabled={refunding} onChange={e => setRefundReason(e.target.value)}/></label>
                    <button
                      type="button"
                      disabled={refunding}
                      onClick={() =>
                        setShowRefundConfirm(false)
                      }
                      className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Vazgeç
                    </button>

                    <button
                      type="button"
                      disabled={refunding}
                      onClick={() =>
                        void refundOrder()
                      }
                      className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                    >
                      {refunding
                        ? "İade Ediliyor..."
                        : "Evet, Tam İade Et"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  {canRefund && (
                    <button
                      type="button"
                      disabled={refunding || selectedOrder.status !== "COMPLETED"}
                      onClick={() => {
                        setRefundError("");
                        setShowRefundConfirm(true);
                      }}
                      className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      İade Et
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={refunding}
                    onClick={closeOrderDetails}
                    className="flex-1 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    Kapat
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        {icon}
      </div>

      <p className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-xl font-bold text-slate-950">
        {value}
      </p>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}
