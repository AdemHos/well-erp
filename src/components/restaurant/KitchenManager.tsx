
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type KitchenStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "SERVED";

type KitchenItem = {
  id: string;
  productName: string;
  quantity: string;
  note: string | null;
  kitchenStatus: KitchenStatus;
  createdAt: string;
  kitchenStartedAt: string | null;
  kitchenReadyAt: string | null;
  kitchenServedAt: string | null;
};

type KitchenOrder = {
  id: string;
  tabNumber: string;
  openedAt: string;
  table: {
    id: string;
    name: string;
  };
  items: KitchenItem[];
};

type KitchenResponse = {
  success: boolean;
  orders: KitchenOrder[];
  stats: {
    pending: number;
    preparing: number;
    ready: number;
    served: number;
  };
  error?: string;
};

type Filter = "ACTIVE" | "ALL" | KitchenStatus;

type KitchenManagerProps = {
  branchId: string;
};

const STATUS = {
  PENDING: {
    label: "Bekliyor",
    className: "bg-amber-100 text-amber-800",
    action: "Hazırlamaya Başla",
    next: "PREPARING",
  },
  PREPARING: {
    label: "Hazırlanıyor",
    className: "bg-blue-100 text-blue-800",
    action: "Hazır",
    next: "READY",
  },
  READY: {
    label: "Hazır",
    className: "bg-green-100 text-green-800",
    action: "Servis Edildi",
    next: "SERVED",
  },
  SERVED: {
    label: "Servis Edildi",
    className: "bg-gray-100 text-gray-600",
    action: null,
    next: null,
  },
} as const;

function elapsedTime(date: string, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(date).getTime()) / 60000)
  );

  if (minutes < 60) {
    return `${minutes} dk`;
  }

  const hours = Math.floor(minutes / 60);

  return `${hours} sa ${minutes % 60} dk`;
}

export default function KitchenManager({
  branchId,
}: KitchenManagerProps) {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [updatingId, setUpdatingId] = useState<string | null>(
    null
  );

  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [now, setNow] = useState(() => Date.now());

  // Bildirim ayarları
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [newItemIds, setNewItemIds] = useState<string[]>([]);
  const [notification, setNotification] = useState("");

  // Sipariş takibi
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const loadingRef = useRef(false);
  const soundEnabledRef = useRef(false);

  // Ses motoru
  const audioContextRef = useRef<AudioContext | null>(null);

  // Bildirim temizleme
  const notificationTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  // --------------------------------------------------
  // BİLDİRİM SESİ
  // --------------------------------------------------

  const playNotificationSound = useCallback(async () => {
    try {
      const AudioContextClass = window.AudioContext;

      if (!AudioContextClass) return;

      let audioContext = audioContextRef.current;

      if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      if (audioContext.state !== "running") return;

      const startTime = audioContext.currentTime;

      const playTone = (
        frequency: number,
        delay: number,
        duration: number
      ) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = "sine";

        oscillator.frequency.setValueAtTime(
          frequency,
          startTime + delay
        );

        gainNode.gain.setValueAtTime(
          0.0001,
          startTime + delay
        );

        gainNode.gain.exponentialRampToValueAtTime(
          0.16,
          startTime + delay + 0.02
        );

        gainNode.gain.exponentialRampToValueAtTime(
          0.0001,
          startTime + delay + duration
        );

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start(startTime + delay);
        oscillator.stop(startTime + delay + duration + 0.02);
      };

      playTone(660, 0, 0.18);
      playTone(880, 0.24, 0.24);
    } catch (err) {
      console.warn("Bildirim sesi çalınamadı:", err);
    }
  }, []);

  // --------------------------------------------------
  // SES AÇ / KAPAT
  // --------------------------------------------------

  async function toggleSound() {
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);

      try {
        localStorage.setItem(
          "wellpos-kitchen-sound",
          "false"
        );
      } catch {
        // Tarayıcı depolaması kullanılamayabilir.
      }

      return;
    }

    try {
      let audioContext = audioContextRef.current;

      if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContext();
        audioContextRef.current = audioContext;
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      if (audioContext.state !== "running") {
        setError(
          "Tarayıcı ses çalmaya izin vermedi. Tekrar deneyin."
        );
        return;
      }

      soundEnabledRef.current = true;
      setSoundEnabled(true);
      setError("");

      try {
        localStorage.setItem(
          "wellpos-kitchen-sound",
          "true"
        );
      } catch {
        // Tarayıcı depolaması kullanılamayabilir.
      }

      void playNotificationSound();
    } catch {
      setError("Bildirim sesi etkinleştirilemedi.");
    }
  }

  // --------------------------------------------------
  // YENİ SİPARİŞ BİLDİRİMİ
  // --------------------------------------------------

  const showNewOrderNotification = useCallback(
    (items: KitchenItem[]) => {
      if (items.length === 0) return;

      const ids = items.map((item) => item.id);

      setNewItemIds((previous) => [
        ...new Set([...previous, ...ids]),
      ]);

      const message =
        items.length === 1
          ? `Yeni sipariş: ${items[0].productName}`
          : `${items.length} yeni sipariş kalemi geldi!`;

      setNotification(message);

      if (soundEnabledRef.current) {
        void playNotificationSound();
      }

      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }

      notificationTimerRef.current = setTimeout(() => {
        setNewItemIds([]);
        setNotification("");
        notificationTimerRef.current = null;
      }, 8000);
    },
    [playNotificationSound]
  );

  // --------------------------------------------------
  // SİPARİŞLERİ YÜKLE
  // --------------------------------------------------

  const loadOrders = useCallback(
    async (silent = false) => {
      if (loadingRef.current) return;

      loadingRef.current = true;

      if (!silent) {
        setRefreshing(true);
      }

      try {
        const response = await fetch(
          `/api/restaurant/kitchen?branchId=${encodeURIComponent(
            branchId
          )}`,
          {
            cache: "no-store",
          }
        );

        const data: KitchenResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "Mutfak siparişleri yüklenemedi."
          );
        }

        const currentItems = data.orders.flatMap(
          (order) => order.items
        );

        const currentIds = new Set(
          currentItems.map((item) => item.id)
        );

        if (!initializedRef.current) {
          // İlk yüklemede mevcut siparişler için
          // bildirim verme.
          initializedRef.current = true;
          knownItemIdsRef.current = currentIds;
        } else {
          const newItems = currentItems.filter(
            (item) =>
              !knownItemIdsRef.current.has(item.id) &&
              item.kitchenStatus === "PENDING"
          );

          if (newItems.length > 0) {
            showNewOrderNotification(newItems);
          }

          currentIds.forEach((id) => {
            knownItemIdsRef.current.add(id);
          });
        }

        setOrders(data.orders);
        setError("");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Beklenmeyen bir hata oluştu."
        );
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [branchId, showNewOrderNotification]
  );

  // --------------------------------------------------
  // OTOMATİK YENİLEME
  // --------------------------------------------------

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
    try {
      const savedSound = localStorage.getItem(
        "wellpos-kitchen-sound"
      );

      if (savedSound === "true") {
        setNotification(
          "Ses tercihiniz açık. Bildirim sesi için Sesi Aç butonuna basın."
        );
      }
    } catch {
      // Depolama kullanılamıyorsa varsayılan kapalı.
    }

    void loadOrders(true);
    }, 0);

    const refreshInterval = window.setInterval(() => {
      void loadOrders(true);
    }, 5000);

    const clockInterval = window.setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);

      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, [loadOrders]);

  // Ses motorunu temizle.
  useEffect(() => {
    return () => {
      const context = audioContextRef.current;

      if (context && context.state !== "closed") {
        void context.close().catch(() => {});
      }
    };
  }, []);

  // --------------------------------------------------
  // MUTFAK DURUMUNU GÜNCELLE
  // --------------------------------------------------

  async function updateStatus(
    itemId: string,
    status: KitchenStatus
  ) {
    if (updatingId) return;

    setUpdatingId(itemId);
    setError("");

    try {
      const response = await fetch(
        `/api/restaurant/kitchen/items/${itemId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Sipariş durumu güncellenemedi."
        );
      }

      await loadOrders(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sipariş durumu güncellenemedi."
      );

      await loadOrders(true);
    } finally {
      setUpdatingId(null);
    }
  }

  // --------------------------------------------------
  // İSTATİSTİKLER
  // --------------------------------------------------

  const allItems = orders.flatMap((order) => order.items);

  const stats = {
    pending: allItems.filter(
      (item) => item.kitchenStatus === "PENDING"
    ).length,

    preparing: allItems.filter(
      (item) => item.kitchenStatus === "PREPARING"
    ).length,

    ready: allItems.filter(
      (item) => item.kitchenStatus === "READY"
    ).length,

    served: allItems.filter(
      (item) => item.kitchenStatus === "SERVED"
    ).length,
  };

  const filteredOrders = orders
    .map((order) => ({
      ...order,
      items: order.items.filter((item) => {
        if (filter === "ALL") return true;

        if (filter === "ACTIVE") {
          return item.kitchenStatus !== "SERVED";
        }

        return item.kitchenStatus === filter;
      }),
    }))
    .filter((order) => order.items.length > 0);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Mutfak Yönetimi
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Gelen siparişleri ve hazırlık süreçlerini yönetin. Son 24 saatte servis edilen siparişler de listelenir.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void toggleSound()}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              soundEnabled
                ? "bg-green-600 text-white hover:bg-green-700"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {soundEnabled ? "🔊 Ses Açık" : "🔇 Sesi Aç"}
          </button>

          <button
            onClick={() => void loadOrders()}
            disabled={refreshing}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {refreshing ? "Yenileniyor..." : "↻ Yenile"}
          </button>
        </div>
      </div>

      {/* YENİ SİPARİŞ BİLDİRİMİ */}
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800"
        >
          🔔 {notification}
        </div>
      )}

      {/* İSTATİSTİKLER */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Bekleyen",
            value: stats.pending,
            color: "text-amber-700",
            bg: "bg-amber-50",
          },
          {
            label: "Hazırlanan",
            value: stats.preparing,
            color: "text-blue-700",
            bg: "bg-blue-50",
          },
          {
            label: "Hazır",
            value: stats.ready,
            color: "text-green-700",
            bg: "green-50",
          },
          {
            label: "Servis Edilen",
            value: stats.served,
            color: "text-gray-700",
            bg: "bg-gray-100",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-2xl border border-gray-100 p-5 ${stat.bg}`}
          >
            <p className="text-sm text-gray-600">
              {stat.label}
            </p>

            <p
              className={`mt-2 text-3xl font-bold ${stat.color}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* FİLTRELER */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: "ACTIVE", label: "Aktif Siparişler" },
          { value: "PENDING", label: "Bekleyenler" },
          { value: "PREPARING", label: "Hazırlananlar" },
          { value: "READY", label: "Hazırlar" },
          { value: "SERVED", label: "Servis Edilenler" },
          { value: "ALL", label: "Tümü" },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setFilter(option.value as Filter)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              filter === option.value
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* HATA */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* SİPARİŞ KARTLARI */}
      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500">
          Siparişler yükleniyor...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="text-lg font-semibold text-gray-800">
            Görüntülenecek sipariş yok
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Yeni adisyon ürünleri eklendiğinde burada
            görüntülenecek.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredOrders.map((order) => {
            const hasNewItems = order.items.some((item) =>
              newItemIds.includes(item.id)
            );

            return (
              <div
                key={order.id}
                className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${
                  hasNewItems
                    ? "border-green-400 ring-2 ring-green-200"
                    : "border-gray-200"
                }`}
              >
                <div className="border-b border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-gray-900">
                          {order.table.name}
                        </h2>

                        {hasNewItems && (
                          <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold text-white">
                            YENİ
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-gray-500">
                        {order.tabNumber}
                      </p>
                    </div>

                    <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                      ⏱ {elapsedTime(order.openedAt, now)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-gray-500">
                    {order.items.length} sipariş kalemi
                  </p>
                </div>

                <div className="divide-y divide-gray-100">
                  {order.items.map((item) => {
                    const config = STATUS[item.kitchenStatus];
                    const isNew = newItemIds.includes(item.id);

                    return (
                      <div
                        key={item.id}
                        className={`p-4 transition-colors duration-300 ${
                          isNew ? "bg-green-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-start gap-2">
                              <span className="rounded-lg bg-gray-100 px-2 py-1 text-sm font-bold text-gray-800">
                                {item.quantity}x
                              </span>

                              <div>
                                <p className="font-semibold text-gray-900">
                                  {item.productName}
                                </p>

                                {item.note && (
                                  <p className="mt-1 text-sm text-orange-700">
                                    Not: {item.note}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          <span
                            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${config.className}`}
                          >
                            {config.label}
                          </span>
                        </div>

                        <p className="mt-3 text-xs text-gray-400">
                          Sipariş süresi:{" "}
                          {elapsedTime(item.createdAt, now)}
                        </p>

                        {config.next && (
                          <button
                            onClick={() =>
                              void updateStatus(
                                item.id,
                                config.next as KitchenStatus
                              )
                            }
                            disabled={updatingId !== null}
                            className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {updatingId === item.id
                              ? "Güncelleniyor..."
                              : config.action}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        Siparişler her 5 saniyede bir otomatik yenilenir.
      </p>
    </div>
  );
}
