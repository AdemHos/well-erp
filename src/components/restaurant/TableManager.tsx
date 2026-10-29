
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  Armchair,
  CirclePlus,
  Loader2,
  RefreshCw,
  Users,
  X,
  Search,
  Plus,
  Minus,
  Receipt,
  ShoppingCart,
  ArrowLeft,
  Trash2,
  Banknote,
  CreditCard,
  CheckCircle2,
} from "lucide-react";

// ======================================================
// TYPES
// ======================================================

type ActiveTab = {
  id: string;
  tabNumber: string;
  total: string;
  openedAt: string;
};

type RestaurantTable = {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  branchId: string;
  status: "EMPTY" | "OCCUPIED";
  activeTab: ActiveTab | null;
};

type TabItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: string;
  unitPrice: string;
  total: string;
  note: string | null;
  kitchenStatus?: "PENDING" | "PREPARING" | "READY" | "SERVED";
};

type TabDetail = {
  id: string;
  tabNumber: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  subtotal: string;
  total: string;
  note: string | null;
  table: {
    id: string;
    name: string;
    capacity: number;
  };
  items: TabItem[];
};

type Product = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  isActive: boolean;
  isSellable: boolean;
};

type PaymentMethod = "CASH" | "CARD";

type Props = {
  branchId: string;
  canManage: boolean;
  canOperate: boolean;
  canCheckout: boolean;
  financeAccounts: { id: string; name: string; type: string }[];
};

// ======================================================
// HELPERS
// ======================================================

function formatCurrency(value: number | string) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    throw new Error(
      `Sunucudan boş yanıt geldi. HTTP ${response.status}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error("API_RESPONSE_ERROR:", {
      url: response.url,
      status: response.status,

    });

    throw new Error(
      `API hatası: HTTP ${response.status}. Sunucu geçerli JSON döndürmedi.`
    );
  }
}

// ======================================================
// MAIN COMPONENT
// ======================================================

export default function TableManager({
  branchId,
  canManage, canOperate, canCheckout, financeAccounts,
}: Props) {
  // TABLE STATE

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // CREATE TABLE STATE

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tableName, setTableName] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // OPEN TAB STATE

  const [openingTableId, setOpeningTableId] = useState<string | null>(
    null
  );

  // TAB DETAIL STATE

  const [selectedTabId, setSelectedTabId] = useState<string | null>(
    null
  );
  const [tabDetail, setTabDetail] = useState<TabDetail | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState("");

  // PRODUCT STATE

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(
    null
  );
  const [quantity, setQuantity] = useState(1);

  // MUTATION STATE

  const [mutatingItem, setMutatingItem] = useState(false);
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(
    null
  );

  // CHECKOUT STATE

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("CASH");
  const [accountChoices, setAccountChoices] = useState<Record<string, string>>({});
  const paymentAccounts = financeAccounts.filter(account => account.type === paymentMethod);
  const selectedAccountId = paymentAccounts.length === 1 ? paymentAccounts[0].id : accountChoices[paymentMethod] ?? "";
  const [checkoutMessage, setCheckoutMessage] = useState("");

  // ======================================================
  // FETCH TABLES
  // ======================================================

  const fetchTables = useCallback(async () => {
    if (!branchId) {
      setTables([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/restaurant/tables?branchId=${encodeURIComponent(branchId)}`,
        { cache: "no-store" }
      );

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.error || "Masalar alınamadı.");
      }

      setTables(data.tables ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Masalar yüklenirken hata oluştu."
      );
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void fetchTables(); });
    return () => { active = false; };
  }, [fetchTables]);

  // ======================================================
  // TABLE STATISTICS
  // ======================================================

  const stats = useMemo(() => {
    const active = tables.filter((table) => table.isActive);

    return {
      total: active.length,
      empty: active.filter((table) => table.status === "EMPTY").length,
      occupied: active.filter(
        (table) => table.status === "OCCUPIED"
      ).length,
    };
  }, [tables]);

  // ======================================================
  // CREATE TABLE
  // ======================================================

  function openCreateModal() {
    setTableName("");
    setCapacity(4);
    setCreateError("");
    setShowCreateModal(true);
  }

  async function createTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      creating ||
      !branchId ||
      !canManage ||
      !tableName.trim() ||
      capacity < 1 ||
      capacity > 50
    ) {
      return;
    }

    try {
      setCreating(true);
      setCreateError("");

      const response = await fetch("/api/restaurant/tables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: tableName.trim(),
          capacity,
          branchId,
        }),
      });

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.error || "Masa oluşturulamadı.");
      }

      setShowCreateModal(false);
      await fetchTables();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Masa oluşturulamadı."
      );
    } finally {
      setCreating(false);
    }
  }

  // ======================================================
  // FETCH TAB DETAIL
  // ======================================================

  const fetchTabDetail = useCallback(async (tabId: string) => {
    const response = await fetch(
      `/api/restaurant/tabs/${encodeURIComponent(tabId)}`,
      { cache: "no-store" }
    );

    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(data.error || "Adisyon detayları alınamadı.");
    }

    setTabDetail(data.tab as TabDetail);
  }, []);

  // ======================================================
  // FETCH PRODUCTS
  // ======================================================

  const fetchProducts = useCallback(async () => {
    try {
      setProductsLoading(true);

      const response = await fetch("/api/products", {
        cache: "no-store",
      });

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.error || "Ürünler alınamadı.");
      }

      const productList = Array.isArray(data)
        ? data
        : Array.isArray(data.products)
          ? data.products
          : [];

      const normalizedProducts: Product[] = productList
        .filter(
          (product: Product) => product.isActive && product.isSellable
        )
        .map(
          (product: Product & { price: string | number }) => ({
            ...product,
            price: Number(product.price),
          })
        );

      setProducts(normalizedProducts);
    } catch (err) {
      setTabError(
        err instanceof Error ? err.message : "Ürünler alınamadı."
      );
    } finally {
      setProductsLoading(false);
    }
  }, []);

  // ======================================================
  // OPEN TAB DETAIL
  // ======================================================

  async function openTabDetail(tabId: string) {
    setSelectedTabId(tabId);
    setTabDetail(null);
    setTabError("");
    setSelectedProduct(null);
    setProductSearch("");
    setQuantity(1);
    setPaymentMethod("CASH");

    try {
      setTabLoading(true);

      await Promise.all([
        fetchTabDetail(tabId),
        fetchProducts(),
      ]);
    } catch (err) {
      setTabError(
        err instanceof Error ? err.message : "Adisyon yüklenemedi."
      );
    } finally {
      setTabLoading(false);
    }
  }

  function closeTabDetail() {
    if (mutatingItem || checkoutLoading) return;

    setSelectedTabId(null);
    setTabDetail(null);
    setSelectedProduct(null);
    setTabError("");
    setPaymentMethod("CASH");
  }

  // ======================================================
  // OPEN TAB
  // ======================================================

  async function openTab(tableId: string) {
    if (!canOperate || openingTableId) return;

    try {
      setOpeningTableId(tableId);
      setError("");
      setCheckoutMessage("");

      const response = await fetch("/api/restaurant/tabs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tableId }),
      });

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(data.error || "Adisyon açılamadı.");
      }

      await fetchTables();

      if (data.tab?.id) {
        await openTabDetail(data.tab.id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Adisyon açılamadı."
      );
    } finally {
      setOpeningTableId(null);
    }
  }

  // ======================================================
  // FILTER PRODUCTS
  // ======================================================

  const filteredProducts = useMemo(() => {
    const search = productSearch
      .toLocaleLowerCase("tr-TR")
      .trim();

    if (!search) return products;

    return products.filter((product) =>
      product.name
        .toLocaleLowerCase("tr-TR")
        .includes(search)
    );
  }, [products, productSearch]);

  // ======================================================
  // REFRESH AFTER MUTATION
  // ======================================================

  async function refreshAfterMutation(tabId: string) {
    await fetchTabDetail(tabId);
    await fetchTables();
  }

  // ======================================================
  // ADD PRODUCT
  // ======================================================

  async function addProductToTab() {
    if (
      !canOperate ||
      !selectedTabId ||
      !selectedProduct ||
      mutatingItem ||
      checkoutLoading ||
      quantity < 1 ||
      quantity > 999
    ) {
      return;
    }

    const tabId = selectedTabId;

    try {
      setMutatingItem(true);
      setMutatingItemId(null);
      setTabError("");

      const response = await fetch(
        `/api/restaurant/tabs/${encodeURIComponent(tabId)}/items`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productId: selectedProduct.id,
            quantity,
          }),
        }
      );

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          data.error || "Ürün adisyona eklenemedi."
        );
      }

      await refreshAfterMutation(tabId);
      setSelectedProduct(null);
      setQuantity(1);
    } catch (err) {
      setTabError(
        err instanceof Error
          ? err.message
          : "Ürün eklenirken hata oluştu."
      );
    } finally {
      setMutatingItem(false);
      setMutatingItemId(null);
    }
  }

  // ======================================================
  // UPDATE ITEM QUANTITY
  // ======================================================

  async function updateItemQuantity(
    itemId: string,
    newQuantity: number
  ) {
    if (
      !canOperate ||
      !selectedTabId ||
      mutatingItem ||
      checkoutLoading ||
      !Number.isInteger(newQuantity) ||
      newQuantity < 1 ||
      newQuantity > 999
    ) {
      return;
    }

    const tabId = selectedTabId;

    try {
      setMutatingItem(true);
      setMutatingItemId(itemId);
      setTabError("");

      const response = await fetch(
        `/api/restaurant/tabs/${encodeURIComponent(tabId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            quantity: newQuantity,
          }),
        }
      );

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          data.error || "Ürün miktarı güncellenemedi."
        );
      }

      await refreshAfterMutation(tabId);
    } catch (err) {
      setTabError(
        err instanceof Error
          ? err.message
          : "Miktar güncellenirken hata oluştu."
      );
    } finally {
      setMutatingItem(false);
      setMutatingItemId(null);
    }
  }

  // ======================================================
  // DELETE ITEM
  // ======================================================

  async function deleteTabItem(itemId: string) {
    if (
      !canOperate ||
      !selectedTabId ||
      mutatingItem ||
      checkoutLoading
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Bu ürünü adisyondan kaldırmak istiyor musunuz?"
    );

    if (!confirmed) return;

    const tabId = selectedTabId;

    try {
      setMutatingItem(true);
      setMutatingItemId(itemId);
      setTabError("");

      const response = await fetch(
        `/api/restaurant/tabs/${encodeURIComponent(tabId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "DELETE",
        }
      );

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          data.error || "Ürün adisyondan kaldırılamadı."
        );
      }

      await refreshAfterMutation(tabId);
    } catch (err) {
      setTabError(
        err instanceof Error
          ? err.message
          : "Ürün silinirken hata oluştu."
      );
    } finally {
      setMutatingItem(false);
      setMutatingItemId(null);
    }
  }

  async function cancelEmptyTab() {
    if (!canOperate || !tabDetail || tabDetail.items.length || checkoutLoading) return;
    setCheckoutLoading(true); setTabError("");
    try {
      const response = await fetch("/api/restaurant/tabs/" + encodeURIComponent(tabDetail.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CANCEL_EMPTY" }) });
      const data = await readJson(response); if (!response.ok) throw new Error(data.error ?? "Adisyon kapatılamadı.");
      setSelectedTabId(null); setTabDetail(null); await fetchTables();
    } catch (error) { setTabError(error instanceof Error ? error.message : "Adisyon kapatılamadı."); }
    finally { setCheckoutLoading(false); }
  }
  // ======================================================
  // CHECKOUT TAB
  // ======================================================

  async function checkoutTab() {
    if (
      !canCheckout ||
      !selectedTabId ||
      checkoutLoading ||
      mutatingItem ||
      !tabDetail ||
      tabDetail.status !== "OPEN" ||
      tabDetail.items.length === 0
    ) {
      return;
    }

    if (!selectedAccountId) { setTabError("Tahsilat hesabını seçin. Aktif hesap yoksa Finans bölümünden oluşturun."); return; }
    const tabId = selectedTabId;

    const confirmed = window.confirm(
      `${formatCurrency(tabDetail.total)} tutarındaki adisyon ` +
      `${paymentMethod === "CASH" ? "nakit" : "kart"} olarak kapatılsın mı?\n\n` +
      "Tahsilatın gerçekleştiğini onaylayın."
    );

    if (!confirmed) return;

    try {
      setCheckoutLoading(true);
      setTabError("");
      setCheckoutMessage("");

      const response = await fetch(
        `/api/restaurant/tabs/${encodeURIComponent(tabId)}/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentMethod,
            financeAccountId: selectedAccountId,
          }),
        }
      );

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          data.error || "Ödeme tamamlanamadı."
        );
      }

      setSelectedTabId(null);
      setTabDetail(null);
      setSelectedProduct(null);
      setPaymentMethod("CASH");

      setCheckoutMessage(
        `Ödeme başarıyla kaydedildi. Satış No: ${data.orderNumber}`
      );

      await fetchTables();
    } catch (err) {
      setTabError(
        err instanceof Error
          ? err.message
          : "Ödeme sırasında hata oluştu."
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <div className="restaurant-workspace space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">
            Masalar & Adisyonlar
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Aktif şubenin masalarını yönetin, adisyon açın
            ve ödemeleri tamamlayın.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchTables()}
            disabled={loading}
            title="Masaları yenile"
            className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>

          {canManage && branchId && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <CirclePlus size={18} />
              Yeni Masa
            </button>
          )}
        </div>
      </div>

      {/* STATISTICS */}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Toplam Masa" value={stats.total} />
        <StatCard label="Boş Masa" value={stats.empty} />
        <StatCard label="Dolu Masa" value={stats.occupied} />
      </div>

      {/* CHECKOUT SUCCESS */}

      {checkoutMessage && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
        >
          <CheckCircle2 size={20} className="shrink-0" />
          <p>{checkoutMessage}</p>

          <button
            type="button"
            onClick={() => setCheckoutMessage("")}
            className="ml-auto text-emerald-600"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* ERROR */}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* TABLE CARDS */}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-16 text-slate-500">
          <Loader2 className="animate-spin" />
          Masalar yükleniyor...
        </div>
      ) : tables.length === 0 ? (
        <EmptyState message="Bu şubede henüz masa bulunmuyor." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => {
            const occupied = table.status === "OCCUPIED";
            const isOpening = openingTableId === table.id;

            return (
              <div
                key={table.id}
                data-table-state={!table.isActive ? "inactive" : occupied ? "occupied" : "empty"}
                className={`restaurant-table-card rounded-2xl border bg-white p-5 shadow-sm ${
                  !table.isActive
                    ? "border-slate-200 opacity-60"
                    : occupied
                      ? "border-orange-200"
                      : "border-emerald-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                      occupied
                        ? "bg-orange-50 text-orange-600"
                        : "bg-emerald-50 text-emerald-600"
                    }`}
                  >
                    <Armchair size={23} />
                  </div>

                  <span
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      !table.isActive
                        ? "bg-slate-100 text-slate-600"
                        : occupied
                          ? "bg-orange-50 text-orange-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {!table.isActive
                      ? "Pasif"
                      : occupied
                        ? "Dolu"
                        : "Boş"}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-bold text-slate-950">
                  {table.name}
                </h3>

                <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                  <Users size={16} />
                  {table.capacity} kişilik
                </div>

                {table.activeTab && (
                  <div className="restaurant-open-tab mt-4 rounded-xl bg-orange-50 p-3">
                    <p className="text-xs text-orange-700">
                      Açık Adisyon
                    </p>

                    <p className="restaurant-tab-number mt-1 break-all text-xs font-semibold text-orange-900">
                      {table.activeTab.tabNumber}
                    </p>

                    <p className="restaurant-tab-total mt-2 text-lg font-bold text-orange-900">
                      {formatCurrency(table.activeTab.total)}
                    </p>
                  </div>
                )}

                <div className="mt-5 border-t border-slate-100 pt-4">
                  {!table.isActive ? (
                    <p className="text-center text-xs text-slate-400">
                      Kullanım dışı
                    </p>
                  ) : occupied && table.activeTab ? (
                    <button
                      type="button"
                      onClick={() =>
                        void openTabDetail(table.activeTab!.id)
                      }
                      className="restaurant-view-tab flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600"
                    >
                      <Receipt size={17} />
                      Adisyonu Görüntüle
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openTab(table.id)}
                      disabled={!canOperate || openingTableId !== null}
                      className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {isOpening ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2
                            size={16}
                            className="animate-spin"
                          />
                          Açılıyor...
                        </span>
                      ) : (
                        "Adisyon Aç"
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================
          CREATE TABLE MODAL
      ================================================== */}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-table-title"
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h2
                id="create-table-title"
                className="text-lg font-bold text-slate-950"
              >
                Yeni Masa Oluştur
              </h2>

              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={createTable} className="space-y-5 p-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Masa Adı
                </label>

                <input
                  value={tableName}
                  onChange={(event) =>
                    setTableName(event.target.value)
                  }
                  maxLength={100}
                  required
                  placeholder="Örn: Masa 1"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Kişi Kapasitesi
                </label>

                <input
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={capacity}
                  onChange={(event) =>
                    setCapacity(Number(event.target.value))
                  }
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              {createError && (
                <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                  {createError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  disabled={
                    creating ||
                    !tableName.trim() ||
                    capacity < 1 ||
                    capacity > 50
                  }
                  className="flex-1 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {creating ? "Oluşturuluyor..." : "Masa Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================
          TAB DETAIL MODAL
      ================================================== */}

      {selectedTabId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tab-detail-title"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* MODAL HEADER */}

            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h2
                  id="tab-detail-title"
                  className="text-xl font-bold text-slate-950"
                >
                  {tabDetail?.table.name ?? "Adisyon Detayı"}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  {tabDetail?.tabNumber ?? "Yükleniyor..."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeTabDetail}
                disabled={mutatingItem || checkoutLoading}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={21} />
              </button>
            </div>

            {canCheckout && <label className="px-5 pt-3 text-sm">Tahsilat hesabı<select className="ml-2 rounded-lg border p-2" value={selectedAccountId} onChange={event => setAccountChoices(current => ({ ...current, [paymentMethod]: event.target.value }))}><option value="">Hesap seçin</option>{paymentAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
            {canOperate && tabDetail?.items.length === 0 && <button className="m-5 rounded-lg border p-2 text-rose-700" disabled={checkoutLoading} onClick={cancelEmptyTab}>Boş adisyonu iptal et ve masayı kapat</button>}
            {tabLoading ? (
              <div className="flex items-center justify-center gap-3 p-20 text-slate-500">
                <Loader2 className="animate-spin" />
                Adisyon yükleniyor...
              </div>
            ) : (
              <div className={`grid min-h-0 flex-1 overflow-y-auto ${canOperate ? "lg:grid-cols-[1fr_360px]" : "grid-cols-1"}`}>
                {/* PRODUCT CATALOG */}

                {canOperate && <div className="space-y-4 border-r border-slate-200 p-5">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={19} />
                    <h3 className="font-bold text-slate-950">
                      Ürünler
                    </h3>
                  </div>

                  <div className="relative">
                    <Search
                      size={18}
                      className="absolute left-3 top-3 text-slate-400"
                    />

                    <input
                      value={productSearch}
                      onChange={(event) =>
                        setProductSearch(event.target.value)
                      }
                      placeholder="Ürün ara..."
                      className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500"
                    />
                  </div>

                  {productsLoading ? (
                    <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
                      <Loader2 className="animate-spin" />
                      Ürünler yükleniyor...
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {filteredProducts.map((product) => (
                        <button
                          type="button"
                          key={product.id}
                          onClick={() => {
                            setSelectedProduct(product);
                            setQuantity(1);
                          }}
                          disabled={mutatingItem || checkoutLoading}
                          className={`rounded-xl border p-4 text-left transition disabled:opacity-50 ${
                            selectedProduct?.id === product.id
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:border-slate-400"
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {product.name}
                          </p>

                          <p className="mt-2 text-sm font-bold text-slate-700">
                            {formatCurrency(product.price)}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  {!productsLoading &&
                    filteredProducts.length === 0 && (
                      <p className="py-8 text-center text-sm text-slate-500">
                        Ürün bulunamadı.
                      </p>
                    )}

                  {/* SELECTED PRODUCT */}

                  {selectedProduct && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">
                            {selectedProduct.name}
                          </p>

                          <p className="text-sm text-slate-600">
                            {formatCurrency(selectedProduct.price)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedProduct(null)}
                          disabled={mutatingItem || checkoutLoading}
                          className="rounded-lg p-2 text-slate-500 hover:bg-white disabled:opacity-50"
                        >
                          <X size={18} />
                        </button>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center rounded-xl border border-slate-200 bg-white">
                          <button
                            type="button"
                            onClick={() =>
                              setQuantity((current) =>
                                Math.max(1, current - 1)
                              )
                            }
                            disabled={
                              mutatingItem ||
                              checkoutLoading ||
                              quantity <= 1
                            }
                            className="p-3 disabled:opacity-30"
                          >
                            <Minus size={16} />
                          </button>

                          <span className="min-w-10 text-center text-sm font-bold">
                            {quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              setQuantity((current) =>
                                Math.min(999, current + 1)
                              )
                            }
                            disabled={
                              mutatingItem ||
                              checkoutLoading ||
                              quantity >= 999
                            }
                            className="p-3 disabled:opacity-30"
                          >
                            <Plus size={16} />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => void addProductToTab()}
                          disabled={mutatingItem || checkoutLoading}
                          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {mutatingItem &&
                          mutatingItemId === null ? (
                            <Loader2
                              size={17}
                              className="animate-spin"
                            />
                          ) : (
                            <Plus size={17} />
                          )}
                          Adisyona Ekle
                        </button>
                      </div>

                      <p className="mt-3 text-right text-sm font-semibold text-slate-700">
                        Eklenecek Tutar:{" "}
                        {formatCurrency(
                          selectedProduct.price * quantity
                        )}
                      </p>
                    </div>
                  )}
                </div>}

                {/* ADISYON PANEL */}

                <div className="flex flex-col bg-slate-50 p-5">
                  <div className="flex items-center gap-2">
                    <Receipt size={19} />
                    <h3 className="font-bold text-slate-950">
                      Adisyon
                    </h3>
                  </div>

                  {tabError && (
                    <div
                      role="alert"
                      className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600"
                    >
                      {tabError}
                    </div>
                  )}

                  {/* ITEM LIST */}

                  <div className="mt-5 flex-1 space-y-3">
                    {tabDetail?.items.length === 0 && (
                      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        Henüz ürün eklenmedi.
                      </p>
                    )}

                    {tabDetail?.items.map((item) => {
                      const itemQuantity = Number(item.quantity);

                      const isMutatingThisItem =
                        mutatingItem &&
                        mutatingItemId === item.id;

                      const canEditItem = canOperate && (!item.kitchenStatus || item.kitchenStatus === "PENDING");

                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-950">
                                {item.productName}
                              </p>

                              <p className="mt-1 text-xs text-slate-500">
                                Birim fiyat:{" "}
                                {formatCurrency(item.unitPrice)}
                              </p>

                              {!canEditItem && (
                                <p className="mt-2 text-xs font-medium text-amber-700">
                                  Mutfakta işleme alındı
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                void deleteTabItem(item.id)
                              }
                              disabled={
                                !canEditItem ||
                                mutatingItem ||
                                checkoutLoading
                              }
                              title={
                                canEditItem
                                  ? "Ürünü adisyondan kaldır"
                                  : "Mutfakta işleme alınan ürün silinemez"
                              }
                              aria-label={`${item.productName} ürününü sil`}
                              className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-40"
                            >
                              {isMutatingThisItem ? (
                                <Loader2
                                  size={17}
                                  className="animate-spin"
                                />
                              ) : (
                                <Trash2 size={17} />
                              )}
                            </button>
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="flex items-center rounded-lg border border-slate-200">
                              <button
                                type="button"
                                onClick={() =>
                                  void updateItemQuantity(
                                    item.id,
                                    itemQuantity - 1
                                  )
                                }
                                disabled={
                                  !canEditItem ||
                                  mutatingItem ||
                                  checkoutLoading ||
                                  itemQuantity <= 1
                                }
                                title="Miktarı azalt"
                                className="p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                              >
                                <Minus size={16} />
                              </button>

                              <span className="min-w-9 text-center text-sm font-semibold">
                                {item.quantity}
                              </span>

                              <button
                                type="button"
                                onClick={() =>
                                  void updateItemQuantity(
                                    item.id,
                                    itemQuantity + 1
                                  )
                                }
                                disabled={
                                  !canEditItem ||
                                  mutatingItem ||
                                  checkoutLoading ||
                                  itemQuantity >= 999
                                }
                                title="Miktarı artır"
                                className="p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                              >
                                <Plus size={16} />
                              </button>
                            </div>

                            <p className="text-sm font-bold text-slate-950">
                              {formatCurrency(item.total)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* TOTAL AND CHECKOUT */}

                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">
                        Toplam
                      </span>

                      <span className="text-2xl font-bold text-slate-950">
                        {formatCurrency(tabDetail?.total ?? 0)}
                      </span>
                    </div>

                    {canCheckout && <div className="mt-5 space-y-4">
                      <p className="text-sm font-semibold text-slate-700">
                        Ödeme Yöntemi
                      </p>

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("CASH")}
                          disabled={checkoutLoading || mutatingItem}
                          className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold transition disabled:opacity-50 ${
                            paymentMethod === "CASH"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <Banknote size={18} />
                          Nakit
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod("CARD")}
                          disabled={checkoutLoading || mutatingItem}
                          className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold transition disabled:opacity-50 ${
                            paymentMethod === "CARD"
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <CreditCard size={18} />
                          Kart
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => void checkoutTab()}
                        disabled={
                          checkoutLoading ||
                          mutatingItem ||
                          !tabDetail ||
                          tabDetail.status !== "OPEN" ||
                          tabDetail.items.length === 0
                        }
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {checkoutLoading ? (
                          <>
                            <Loader2
                              size={18}
                              className="animate-spin"
                            />
                            Ödeme Kaydediliyor...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={18} />
                            Ödemeyi Tamamla
                          </>
                        )}
                      </button>

                      <p className="text-center text-xs text-slate-400">
                        Tahsilat onaylandığında adisyon kapatılır
                        ve masa boşalır.
                      </p>
                    </div>}
                  </div>
                </div>
              </div>
            )}

            {/* FOOTER */}

            <div className="flex justify-end border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={closeTabDetail}
                disabled={mutatingItem || checkoutLoading}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <ArrowLeft size={16} />
                Masalara Dön
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======================================================
// STAT CARD
// ======================================================

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>

      <p className="mt-2 text-2xl font-bold text-slate-950">
        {value}
      </p>
    </div>
  );
}

// ======================================================
// EMPTY STATE
// ======================================================

function EmptyState({
  message,
}: {
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <Armchair
        size={36}
        className="mx-auto text-slate-300"
      />

      <p className="mt-4 text-sm text-slate-500">
        {message}
      </p>
    </div>
  );
}
