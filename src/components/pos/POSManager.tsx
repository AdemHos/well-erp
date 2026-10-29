
"use client";
import Image from "next/image";

import { useMemo, useRef, useState } from "react";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";
import CustomerPicker, { type SelectedCustomer } from "./CustomerPicker";
import SaleReceipt, { type ReceiptOrder } from "@/components/pos/SaleReceipt";
import { findBarcodeProduct } from "@/lib/integrations";
import { defaultBranchSettings, type BranchSettingsValue } from "@/lib/settings";
import {
  Banknote,
  BadgePercent,
  Check,
  CreditCard,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

// ======================================================
// TYPES
// ======================================================

type Category = {
  id: string;
  name: string;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  unit?: string;
  price: string;
  category: {
    id: string;
    name: string;
  } | null;
};

type CartItem = {
  productId: string;
  name: string;
  unit?: string;
  price: number;
  quantity: number;
};

type PaymentMethod = "CASH" | "CARD";

type DiscountType = "PERCENT" | "FIXED";

type Discount = {
  type: DiscountType;
  value: number;
};

type Props = {
  policy?: BranchSettingsValue;
  actorRole?: string;
  products: Product[];
  categories: Category[];
  branchId: string;
  financeAccounts: { id: string; name: string; type: "CASH" | "CARD" | "BANK" }[];
};

// ======================================================
// HELPERS
// ======================================================

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2,
  }).format(value);
}

// ======================================================
// COMPONENT
// ======================================================

export default function POSManager({
  products,
  categories,
  branchId,
  financeAccounts,
  policy = defaultBranchSettings,
  actorRole = "OWNER",
}: Props) {
  // ====================================================
  // STATES
  // ====================================================

  const [search, setSearch] = useState("");

  const [selectedCategory, setSelectedCategory] =
    useState("ALL");

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>(policy.defaultPaymentMethod);
  const [selectedAccounts, setSelectedAccounts] = useState<Partial<Record<PaymentMethod, string>>>({});
  const paymentAccounts = financeAccounts.filter((account) => account.type === paymentMethod);
  const selectedAccountId = paymentAccounts.length === 1
    ? paymentAccounts[0].id
    : paymentAccounts.find((account) => account.id === selectedAccounts[paymentMethod])?.id ?? "";

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [lastOrder, setLastOrder] = useState<ReceiptOrder | null>(null);
  const saleInFlight = useRef(false);
  const attemptRef = useRef<ClientAttempt | null>(null);

  const [discount, setDiscount] =
    useState<Discount | null>(null);

  const [showCustomDiscount, setShowCustomDiscount] =
    useState(false);

  const [customDiscountType, setCustomDiscountType] =
    useState<DiscountType>("PERCENT");

  const [customDiscountValue, setCustomDiscountValue] =
    useState("");

  const [discountError, setDiscountError] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ====================================================
  // PRODUCT FILTERING
  // ====================================================

  const filteredProducts = useMemo(() => {
    const query = search
      .trim()
      .toLocaleLowerCase("tr-TR");

    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "ALL" ||
        product.category?.id === selectedCategory;

      const matchesSearch =
        !query ||
        product.name
          .toLocaleLowerCase("tr-TR")
          .includes(query) ||
        product.sku
          ?.toLocaleLowerCase("tr-TR")
          .includes(query) ||
        product.barcode
          ?.toLocaleLowerCase("tr-TR")
          .includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [products, search, selectedCategory]);

  // ====================================================
  // CART ACTIONS
  // ====================================================

  function addToCart(product: Product) {
    if (loading) return;

    setError("");
    setSuccess("");

    setCart((currentCart) => {
      const existingItem = currentCart.find(
        (item) => item.productId === product.id
      );

      if (existingItem) {
        return currentCart.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item
        );
      }

      return [
        ...currentCart,
        {
          productId: product.id,
          name: product.name,
          unit: product.unit ?? "PIECE",
          price: Number(product.price),
          quantity: 1,
        },
      ];
    });
  }

  function increaseQuantity(productId: string) {
    if (loading) return;

    setError("");
    setSuccess("");

    setCart((currentCart) =>
      currentCart.map((item) =>
        item.productId === productId
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      )
    );
  }

  function decreaseQuantity(productId: string) {
    if (loading) return;

    setError("");
    setSuccess("");

    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.productId === productId
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeFromCart(productId: string) {
    if (loading) return;

    setError("");
    setSuccess("");

    setCart((currentCart) =>
      currentCart.filter(
        (item) => item.productId !== productId
      )
    );
  }

  function clearCart() {
    if (loading) return;

    setCart([]);
    setDiscount(null);
    setCustomDiscountValue("");
    setDiscountError("");
    setShowCustomDiscount(false);
    setError("");
    setSuccess("");
  }

  // ====================================================
  // CART TOTALS
  // ====================================================

  const subtotal = useMemo(() => {
    return roundMoney(
      cart.reduce(
        (sum, item) =>
          sum + roundMoney(item.price * item.quantity),
        0
      )
    );
  }, [cart]);

  const totalQuantity = useMemo(() => {
    return cart.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
  }, [cart]);

  const discountAmount = useMemo(() => {
    if (!discount || subtotal <= 0) {
      return 0;
    }

    if (discount.type === "PERCENT") {
      return roundMoney(
        (subtotal * discount.value) / 100
      );
    }

    return roundMoney(
      Math.min(discount.value, subtotal)
    );
  }, [discount, subtotal]);

  const total = roundMoney(
    Math.max(0, subtotal - discountAmount)
  );

  const discountExceedsSubtotal =
    discount?.type === "FIXED" &&
    discount.value > subtotal;
  const discountBlocked = discountAmount > 0 && (!policy.discountRoles.includes(actorRole) || (discount?.type === "PERCENT" ? discount.value > policy.maxDiscountPercent : discountAmount * 100 > subtotal * policy.maxDiscountPercent + 0.000001));

  // ====================================================
  // DISCOUNT ACTIONS
  // ====================================================

  function applyQuickDiscount(value: number) {
    if (!policy.discountRoles.includes(actorRole) || value > policy.maxDiscountPercent) { setError(`İndirim yetkinizi ve şube sınırını (%${policy.maxDiscountPercent}) kontrol edin.`); return; }
    if (loading || cart.length === 0) return;

    setDiscount({
      type: "PERCENT",
      value,
    });

    setShowCustomDiscount(false);
    setCustomDiscountValue("");
    setDiscountError("");
    setError("");
    setSuccess("");
  }

  function applyCustomDiscount() {
    if (loading) return;

    setDiscountError("");

    if (cart.length === 0) {
      setDiscountError(
        "İndirim uygulamak için önce sepete ürün ekleyin."
      );
      return;
    }

    const normalizedValue = customDiscountValue
      .trim()
      .replace(",", ".");

    if (!normalizedValue) {
      setDiscountError(
        "Lütfen indirim değerini girin."
      );
      return;
    }

    const parsedValue = Number(normalizedValue);

    if (
      !Number.isFinite(parsedValue) ||
      parsedValue <= 0
    ) {
      setDiscountError(
        "İndirim değeri sıfırdan büyük olmalıdır."
      );
      return;
    }

    const decimalPart = normalizedValue.split(".")[1];

    if (decimalPart && decimalPart.length > 2) {
      setDiscountError(
        "İndirim en fazla iki ondalık basamak içerebilir."
      );
      return;
    }

    if (
      customDiscountType === "PERCENT" &&
      parsedValue > 100
    ) {
      setDiscountError(
        "Yüzdesel indirim %100'ü geçemez."
      );
      return;
    }

    if (
      customDiscountType === "FIXED" &&
      parsedValue > subtotal
    ) {
      setDiscountError(
        "Sabit indirim ara toplamı geçemez."
      );
      return;
    }

    setDiscount({
      type: customDiscountType,
      value: parsedValue,
    });

    setShowCustomDiscount(false);
    setCustomDiscountValue("");
    setDiscountError("");
    setError("");
    setSuccess("");
  }

  function removeDiscount() {
    if (loading) return;

    setDiscount(null);
    setDiscountError("");
    setCustomDiscountValue("");
    setShowCustomDiscount(false);
    setError("");
    setSuccess("");
  }

  // ====================================================
  // COMPLETE SALE
  // ====================================================

  async function completeSale() {
    if (loading || saleInFlight.current) return;

    setError("");
    setSuccess("");

    if (!branchId) {
      setError("Aktif şube bulunamadı.");
      return;
    }

    if (cart.length === 0) {
      setError("Sepet boş.");
      return;
    }

    if (discountBlocked) { setError(`İndirim yetkinizi ve şube sınırını (%${policy.maxDiscountPercent}) kontrol edin.`); return; }
    if (policy.customerSelection === "REQUIRED" && !selectedCustomer) { setError("Bu şubede müşteri seçimi zorunludur."); return; }
    if (discountExceedsSubtotal) {
      setError(
        "İndirim tutarı ara toplamı geçemez. İndirimi güncelleyin."
      );
      return;
    }

    if (total > 0 && !selectedAccountId) {
      setError(paymentAccounts.length === 0
        ? "Bu ödeme yöntemi için aktif şube hesabı yok. Finans bölümünden hesap oluşturup POS sayfasını yenileyin."
        : "Gelirin kaydedileceği finans hesabını seçin.");
      return;
    }

    saleInFlight.current = true;
    try {
      setLoading(true);

      const payload = {
          branchId,
          paymentMethod,
          ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
          ...(total > 0 && selectedAccountId ? { financeAccountId: selectedAccountId } : {}),
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          ...(discount
            ? {
                discount: {
                  type: discount.type,
                  value: discount.value,
                },
              }
            : {}),
      };
      attemptRef.current = clientAttempt(attemptRef.current, payload, "sale:" + branchId);
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, idempotencyKey: attemptRef.current.key }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "Satış tamamlanırken bir hata oluştu."
        );
        return;
      }

      completeAttempt("sale:" + branchId);
      attemptRef.current = null;
      setCart([]);
      setLastOrder(data.order);
      setSelectedCustomer(null);
      setDiscount(null);
      setCustomDiscountValue("");
      setDiscountError("");
      setShowCustomDiscount(false);

      const orderNumber =
        data?.order?.orderNumber ?? "Bilinmiyor";

      setSuccess(
        `Satış tamamlandı — ${orderNumber}`
      );
    } catch (error) {
      console.error("POS_SALE_ERROR:", error);

      setError(
        "Satış sonucu doğrulanamadı. Tekrar denemeden önce satış ve finans kayıtlarını kontrol edin."
      );
    } finally {
      saleInFlight.current = false;
      setLoading(false);
    }
  }

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div className="pos-workspace grid min-h-[calc(100vh-80px)] gap-6 xl:grid-cols-[1fr_400px]">
      {/* ============================================= */}
      {/* PRODUCTS */}
      {/* ============================================= */}

      <section className="min-w-0">
        {/* HEADER */}

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-950">
            POS / Yeni Satış
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Ürünleri seçerek yeni bir satış oluşturun.
          </p>
        </div>

        {/* SEARCH */}

        <div className="relative mb-4">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            type="text"
            aria-label="Ürün, SKU veya barkod ara"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || event.repeat || loading || !search.trim()) return;
              event.preventDefault();
              const product = findBarcodeProduct(products, search);
              if (!product) { setError(`“${search.trim()}” barkoduyla satılabilir ürün bulunamadı.`); return; }
              addToCart(product);
              setSearch("");
            }}
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Ürün, SKU veya barkod ara..."
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
          />
        </div>

        {/* CATEGORIES */}
        <p className="mb-4 text-xs text-slate-500">Barkod okuyucuyla bu alana okutun ve Enter gönderin. Aynı ürün tekrar okutulduğunda sepetteki miktarı artar.</p>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() =>
              setSelectedCategory("ALL")
            }
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
              selectedCategory === "ALL"
                ? "bg-slate-950 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Tümü
          </button>

          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                setSelectedCategory(category.id)
              }
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
                selectedCategory === category.id
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* PRODUCT GRID */}

        {filteredProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Ürün bulunamadı.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addToCart(product)}
                disabled={loading}
                className="pos-product-card group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md disabled:opacity-60"
              >
                {/* PRODUCT IMAGE */}

                <div className="pos-product-image relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  {product.imageUrl ? (
                    <Image unoptimized width={256} height={192}
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-300 shadow-sm">
                        <Package size={26} />
                      </div>
                    </div>
                  )}
                </div>

                {/* PRODUCT INFORMATION */}

                <div className="p-4">
                  <h3 className="truncate font-semibold text-slate-900">
                    {product.name}
                  </h3>

                  {product.sku && (
                    <p className="mt-1 truncate text-xs text-slate-400">
                      SKU: {product.sku}
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <span className="pos-product-price text-lg font-bold text-slate-950">
                      {formatCurrency(
                        Number(product.price)
                      )}
                    </span>

                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                      <Plus size={18} />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ============================================= */}
      {/* CART */}
      {/* ============================================= */}

      <aside className="pos-cart h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-6">
        {/* CART HEADER */}

        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-slate-950">
                <ShoppingCart size={18} />
                Sepet
              </h2>

              <p className="mt-1 text-xs text-slate-500">
                {totalQuantity} ürün
              </p>
            </div>

            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                disabled={loading}
                className="text-xs font-medium text-red-500 transition hover:text-red-600 disabled:opacity-50"
              >
                Sepeti Temizle
              </button>
            )}
          </div>
        </div>

        {/* CART ITEMS */}

        <div className="max-h-[430px] overflow-y-auto">
          {cart.length === 0 ? (
            <div className="p-10 text-center">
              <ShoppingCart
                size={32}
                className="mx-auto text-slate-300"
              />

              <p className="mt-3 text-sm font-medium text-slate-600">
                Sepet boş
              </p>

              <p className="mt-1 text-xs text-slate-400">
                Satışa başlamak için ürün seçin.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cart.map((item) => (
                <div
                  key={item.productId}
                  className="p-4"
                >
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.name}
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        {formatCurrency(item.price)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeFromCart(item.productId)
                      }
                      disabled={loading}
                      aria-label={`${item.name} ürününü sepetten çıkar`}
                      className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center overflow-hidden rounded-lg border border-slate-200">
                      <button
                        type="button"
                        onClick={() =>
                          decreaseQuantity(item.productId)
                        }
                        disabled={loading}
                        aria-label="Miktarı azalt"
                        className="p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Minus size={14} />
                      </button>

                      {item.unit && item.unit !== "PIECE" ? <input aria-label={item.name + " miktarı (" + item.unit + ")"} type="number" min="0.001" max="999999999.999" step="0.001" disabled={loading} className="w-24 p-1 text-center" value={item.quantity} onChange={event => {
                        const value = event.target.value; if (!/^\d+(?:\.\d{0,3})?$/.test(value) || Number(value) <= 0) return;
                        setCart(current => current.map(row => row.productId === item.productId ? { ...row, quantity: Number(value) } : row));
                      }}/> : <span className="pos-quantity min-w-8 text-center text-sm font-medium text-slate-700">{item.quantity}</span>}

                      <button
                        type="button"
                        onClick={() =>
                          increaseQuantity(item.productId)
                        }
                        disabled={loading}
                        aria-label="Miktarı artır"
                        className="p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <span className="text-sm font-semibold text-slate-900">
                      {formatCurrency(
                        item.price * item.quantity
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* =========================================== */}
        {/* DISCOUNT SECTION */}
        {/* =========================================== */}

        <div className="border-t border-slate-100 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <BadgePercent
                size={17}
                className="text-blue-600"
              />
              İndirim
            </p>

            {discount && (
              <button
                type="button"
                onClick={removeDiscount}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                <X size={13} />
                Kaldır
              </button>
            )}
          </div>

          {/* QUICK DISCOUNTS */}

          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 20].map((value) => {
              const isSelected =
                discount?.type === "PERCENT" &&
                discount.value === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    applyQuickDiscount(value)
                  }
                  disabled={
                    loading || cart.length === 0
                  }
                  className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isSelected
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  %{value}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setShowCustomDiscount(
                  !showCustomDiscount
                );
                setDiscountError("");
              }}
              disabled={loading || cart.length === 0}
              className={`rounded-xl border px-2 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                showCustomDiscount
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Özel
            </button>
          </div>

          {/* CUSTOM DISCOUNT FORM */}

          {showCustomDiscount && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-3 text-xs font-medium text-slate-600">
                Özel indirim
              </p>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCustomDiscountType("PERCENT");
                    setDiscountError("");
                  }}
                  disabled={loading}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    customDiscountType === "PERCENT"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  Yüzde (%)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCustomDiscountType("FIXED");
                    setDiscountError("");
                  }}
                  disabled={loading}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    customDiscountType === "FIXED"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  Tutar (₺)
                </button>
              </div>

              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customDiscountValue}
                    onChange={(event) => {
                      setCustomDiscountValue(
                        event.target.value
                      );
                      setDiscountError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyCustomDiscount();
                      }
                    }}
                    disabled={loading}
                    placeholder={
                      customDiscountType === "PERCENT"
                        ? "Örn: 15"
                        : "Örn: 50"
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                  />

                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    {customDiscountType === "PERCENT"
                      ? "%"
                      : "₺"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={applyCustomDiscount}
                  disabled={loading}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  Uygula
                </button>
              </div>

              {discountError && (
                <p
                  role="alert"
                  className="mt-2 text-xs text-red-600"
                >
                  {discountError}
                </p>
              )}
            </div>
          )}

          {/* APPLIED DISCOUNT */}

          {discount && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Check
                  size={15}
                  className="text-emerald-600"
                />

                <span className="text-xs font-medium text-emerald-800">
                  {discount.type === "PERCENT"
                    ? `%${formatNumber(discount.value)} indirim`
                    : `${formatCurrency(discount.value)} indirim`}
                </span>
              </div>

              <span className="text-xs font-semibold text-emerald-700">
                -{formatCurrency(discountAmount)}
              </span>
            </div>
          )}

          {discountExceedsSubtotal && (
            <p
              role="alert"
              className="mt-2 text-xs text-red-600"
            >
              Sepet tutarı değişti. Sabit indirim
              ara toplamı geçemez.
            </p>
          )}
        </div>

        {/* =========================================== */}
        {/* PAYMENT METHOD */}
        {/* =========================================== */}

        <div className="border-t border-slate-100 p-5">
          <p className="mb-3 text-xs font-medium text-slate-500">
            Ödeme Yöntemi
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setPaymentMethod("CASH")
              }
              disabled={loading}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${
                paymentMethod === "CASH"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Banknote size={17} />
              Nakit
            </button>

            <button
              type="button"
              onClick={() =>
                setPaymentMethod("CARD")
              }
              disabled={loading}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${
                paymentMethod === "CARD"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <CreditCard size={17} />
              Kart
            </button>
          </div>
        </div>

        {/* =========================================== */}
        {/* FINANCE ACCOUNT */}
        {/* =========================================== */}
        <div className="border-t border-slate-100 px-5 py-4">
          <label className="block text-xs font-medium text-slate-600">
            Gelirin kaydedileceği hesap
            <select value={selectedAccountId}
              onChange={(event) => setSelectedAccounts((current) => ({ ...current, [paymentMethod]: event.target.value }))}
              disabled={loading || paymentAccounts.length === 0 || total === 0}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-50">
              <option value="">{paymentAccounts.length === 0 ? "Uygun aktif hesap yok" : "Hesap seçiniz"}</option>
              {paymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          {total === 0 && cart.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500">Sıfır tutarlı satış için finans hareketi oluşturulmaz.</p>
          ) : paymentAccounts.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700"><a href="/dashboard/finance" className="underline">Finans bölümünden</a> aktif şubeniz için {paymentMethod === "CASH" ? "nakit" : "kart/POS"} hesabı oluşturup bu sayfayı yenileyin.</p>
          ) : null}
        </div>

        {/* MESSAGES */}
        {/* =========================================== */}

        {error && (
          <div
            role="alert"
            className="mx-5 mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="mx-5 mb-4 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            <Check
              size={17}
              className="mt-0.5 shrink-0"
            />

            {success}
          </div>
        )}

        {/* =========================================== */}
        {/* ORDER SUMMARY */}
        {/* =========================================== */}

        {policy.customerSelection !== "HIDDEN" && <><p className="mx-5 text-xs text-slate-500">Müşteri seçimi: {policy.customerSelection === "REQUIRED" ? "Zorunlu" : "İsteğe bağlı"}</p><CustomerPicker value={selectedCustomer} onChange={setSelectedCustomer} disabled={loading}/></>}
        {lastOrder && <SaleReceipt key={lastOrder.id} order={lastOrder} branchId={branchId} allowAutoPrint />}

        <div className="border-t border-slate-100 p-5">
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                Ara Toplam
              </span>

              <span className="font-medium text-slate-800">
                {formatCurrency(subtotal)}
              </span>
            </div>

            {discount && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-600">
                  İndirim
                  {discount.type === "PERCENT"
                    ? ` (%${formatNumber(discount.value)})`
                    : ""}
                </span>

                <span className="font-semibold text-emerald-600">
                  -{formatCurrency(discountAmount)}
                </span>
              </div>
            )}

            <div className="border-t border-dashed border-slate-200 pt-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-500">
                    Ödenecek Toplam
                  </p>

                  <p className="pos-total mt-1 text-2xl font-bold text-slate-950">
                    {formatCurrency(total)}
                  </p>
                </div>

                <span className="text-sm text-slate-500">
                  {totalQuantity} adet
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void completeSale()}
            disabled={
              loading ||
              cart.length === 0 ||
              !branchId ||
              discountExceedsSubtotal
            }
            className="pos-complete-sale w-full rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Satış Tamamlanıyor..."
              : `${formatCurrency(total)} · Satışı Tamamla`}
          </button>
        </div>
      </aside>
    </div>
  );
}
