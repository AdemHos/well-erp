"use client";
import Image from "next/image";

import { FormEvent, useMemo, useState } from "react";
import {
  Barcode,
  ImageIcon,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { UploadButton } from "@/lib/uploadthing";

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
  unit: "PIECE" | "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER";
  price: string;
  costPrice: string | null;
  isActive: boolean;
  isSellable: boolean;
  categoryId: string | null;
  category: Category | null;
  createdAt: string;
  updatedAt: string;
};

type ProductManagerProps = {
  initialProducts: Product[];
  categories: Category[];
};

type ProductForm = {
  name: string;
  description: string;
  sku: string;
  barcode: string;
  imageUrl: string;
  unit: "PIECE" | "GRAM" | "KILOGRAM" | "MILLILITER" | "LITER";
  price: string;
  costPrice: string;
  categoryId: string;
  isActive: boolean;
  isSellable: boolean;
};

const emptyForm: ProductForm = {
  name: "",
  description: "",
  sku: "",
  barcode: "",
  imageUrl: "",
  unit: "PIECE",
  price: "",
  costPrice: "",
  categoryId: "",
  isActive: true,
  isSellable: true,
};

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));
}

export default function ProductManager({
  initialProducts,
  categories,
}: ProductManagerProps) {
  const [products, setProducts] = useState(initialProducts);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.toLocaleLowerCase("tr-TR");

    return products.filter((product) => {
      const matchesSearch =
        product.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch) ||
        product.sku?.toLocaleLowerCase("tr-TR").includes(normalizedSearch) ||
        product.barcode?.includes(search);

      const matchesCategory =
        !categoryFilter || product.categoryId === categoryFilter;

      const matchesStatus =
        !statusFilter ||
        (statusFilter === "active" ? product.isActive : !product.isActive);

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, search, categoryFilter, statusFilter]);

  function updateForm<K extends keyof ProductForm>(
    field: K,
    value: ProductForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetModal() {
    setIsModalOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
    setError("");
    setIsUploadingImage(false);
  }

  function openCreateModal() {
    setEditingProduct(null);
    setForm(emptyForm);
    setError("");
    setIsUploadingImage(false);
    setIsModalOpen(true);
  }

  function openEditModal(product: Product) {
    setEditingProduct(product);

    setForm({
      name: product.name,
      description: product.description || "",
      sku: product.sku || "",
      barcode: product.barcode || "",
      imageUrl: product.imageUrl || "",
      unit: product.unit,
      price: String(product.price),
      costPrice: product.costPrice ? String(product.costPrice) : "",
      categoryId: product.categoryId || "",
      isActive: product.isActive,
      isSellable: product.isSellable,
    });

    setError("");
    setIsUploadingImage(false);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSubmitting || isUploadingImage) return;
    resetModal();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isUploadingImage) {
      setError("Lütfen ürün görselinin yüklenmesini bekleyin.");
      return;
    }

    if (!form.name.trim()) {
      setError("Ürün adı zorunludur.");
      return;
    }

    if (form.price.trim() === "") {
      setError("Satış fiyatı zorunludur.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const url = editingProduct
        ? `/api/products/${editingProduct.id}`
        : "/api/products";

      const response = await fetch(url, {
        method: editingProduct ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          sku: form.sku,
          barcode: form.barcode,
          imageUrl: form.imageUrl,
          unit: form.unit,
          price: form.price,
          costPrice: form.costPrice,
          categoryId: form.categoryId || null,
          isActive: form.isActive,
          isSellable: form.isSellable,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Bir hata oluştu.");
        return;
      }

      const normalizedProduct: Product = {
        ...data.product,
        imageUrl: data.product.imageUrl ?? null,
        price: String(data.product.price),
        costPrice:
          data.product.costPrice !== null
            ? String(data.product.costPrice)
            : null,
      };

      if (editingProduct) {
        setProducts((current) =>
          current.map((product) =>
            product.id === editingProduct.id ? normalizedProduct : product
          )
        );
      } else {
        setProducts((current) => [normalizedProduct, ...current]);
      }

      resetModal();
    } catch (error) {
      console.error(error);
      setError("Sunucuya bağlanırken bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `"${product.name}" ürününü arşivlemek istediğinizden emin misiniz? Stok ve satış geçmişi korunur.`
    );

    if (!confirmed) return;

    try {
      setDeletingId(product.id);

      const response = await fetch(`/api/products/${product.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        window.alert(data.error || "Ürün silinemedi.");
        return;
      }

      setProducts((current) =>
        current.map((item) => item.id === product.id ? { ...item, isActive: false, isSellable: false } : item)
      );
    } catch (error) {
      console.error(error);
      window.alert("Sunucuya bağlanırken bir hata oluştu.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <div className="relative w-full md:max-w-sm">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ürün, SKU veya barkod ara..."
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Tüm Kategoriler</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Tüm Durumlar</option>
              <option value="active">Aktif</option>
              <option value="passive">Pasif</option>
            </select>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <Plus size={17} />
            Yeni Ürün
          </button>
        </div>

        {/* Empty State */}
        {filteredProducts.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Package size={25} />
            </div>

            <h3 className="mt-4 font-semibold text-slate-800">
              {products.length === 0
                ? "Henüz ürün bulunmuyor"
                : "Ürün bulunamadı"}
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              {products.length === 0
                ? "İlk ürününüzü oluşturarak başlayabilirsiniz."
                : "Arama veya filtre kriterlerinizi değiştirebilirsiniz."}
            </p>
          </div>
        ) : (
          /* Product Table */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Ürün
                  </th>

                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Kategori
                  </th>

                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Satış
                  </th>

                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Maliyet
                  </th>

                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Durum
                  </th>

                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    İşlemler
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="transition hover:bg-slate-50/70"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {product.imageUrl ? (
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                            <Image unoptimized width={256} height={192}
                              src={product.imageUrl}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <Package size={18} />
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {product.name}
                          </p>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            {!product.isSellable && (
                              <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">POS satışına kapalı</span>
                            )}
                            {product.sku && <span>{product.sku}</span>}

                            {product.barcode && (
                              <span className="flex items-center gap-1">
                                <Barcode size={12} />
                                {product.barcode}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {product.category?.name || "Kategorisiz"}
                    </td>

                    <td className="px-6 py-4 text-sm font-semibold text-slate-800">
                      {formatCurrency(product.price)}
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {product.costPrice
                        ? formatCurrency(product.costPrice)
                        : "—"}
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          product.isActive
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {product.isActive ? "Aktif" : "Pasif"}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                          title="Düzenle"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(product)}
                          disabled={deletingId === product.id}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Arşivle"
                        >
                          {deletingId === product.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[1px]">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {editingProduct ? "Ürünü Düzenle" : "Yeni Ürün"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Ürün bilgilerini aşağıdan yönetin.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting || isUploadingImage}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <label className="block text-sm">Ölçü birimi<select className="ml-3 rounded-lg border p-2" value={form.unit} onChange={e => updateForm("unit", e.target.value as ProductForm["unit"])}>{Object.entries({ PIECE: "Adet", GRAM: "Gram", KILOGRAM: "Kilogram", MILLILITER: "Mililitre", LITER: "Litre" }).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {/* Product Image */}
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">
                      Ürün Görseli
                    </label>

                    <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      {form.imageUrl ? (
                        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
                          <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                            <Image unoptimized width={256} height={192}
                              src={form.imageUrl}
                              alt="Ürün görseli"
                              className="h-full w-full object-cover"
                            />
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                                <ImageIcon size={16} />
                              </div>

                              <div>
                                <p className="text-sm font-semibold text-slate-800">
                                  Görsel hazır
                                </p>

                                <p className="text-xs text-slate-500">
                                  Ürün kaydedildiğinde bu görsel kullanılacak.
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => updateForm("imageUrl", "")}
                              disabled={isSubmitting || isUploadingImage}
                              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                              Görseli Kaldır
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center px-5 py-8 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <Upload size={21} />
                          </div>

                          <p className="mt-3 text-sm font-semibold text-slate-800">
                            Ürün görseli yükleyin
                          </p>

                          <p className="mt-1 text-xs text-slate-500">
                            JPG, PNG veya WebP · Maksimum 4 MB
                          </p>

                          <div className="mt-4">
                            <UploadButton
                              endpoint="productImage"
                              appearance={{
                                container: "flex flex-col items-center gap-2",
                                button:
                                  "ut-ready:bg-blue-600 ut-uploading:bg-blue-500 ut-ready:hover:bg-blue-700 h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-none transition",
                                allowedContent: "hidden",
                              }}
                              content={{
                                button({ ready, isUploading }) {
                                  if (isUploading) {
                                    return "Yükleniyor...";
                                  }

                                  if (ready) {
                                    return "Görsel Seç";
                                  }

                                  return "Hazırlanıyor...";
                                },
                              }}
                              onUploadBegin={() => {
                                setIsUploadingImage(true);
                                setError("");
                              }}
                              onClientUploadComplete={(result) => {
                                setIsUploadingImage(false);

                                const imageUrl =
                                  result?.[0]?.serverData?.imageUrl;

                                if (!imageUrl) {
                                  setError("Görsel URL'si alınamadı.");
                                  return;
                                }

                                updateForm("imageUrl", imageUrl);
                              }}
                              onUploadError={(uploadError) => {
                                setIsUploadingImage(false);

                                setError(
                                  uploadError.message ||
                                    "Görsel yüklenirken bir hata oluştu."
                                );
                              }}
                            />
                          </div>

                          {isUploadingImage && (
                            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-blue-600">
                              <Loader2 size={14} className="animate-spin" />
                              Görsel yükleniyor...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Name */}
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">
                      Ürün Adı *
                    </label>

                    <input
                      autoFocus
                      value={form.name}
                      onChange={(event) =>
                        updateForm("name", event.target.value)
                      }
                      placeholder="Örn. Coca Cola 330ml"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Kategori
                    </label>

                    <select
                      value={form.categoryId}
                      onChange={(event) =>
                        updateForm("categoryId", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="">Kategorisiz</option>

                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Durum
                    </label>

                    <select
                      value={form.isActive ? "active" : "passive"}
                      onChange={(event) =>
                        updateForm(
                          "isActive",
                          event.target.value === "active"
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="active">Aktif</option>
                      <option value="passive">Pasif</option>
                    </select>
                  </div>

                  {/* POS availability */}
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={form.isSellable}
                        onChange={(event) => updateForm("isSellable", event.target.checked)}
                        className="h-4 w-4 accent-blue-600" />
                      POS&apos;ta Satışa Sunulsun
                    </label>
                    <p className="mt-2 text-xs text-slate-500">
                      Hammadde olarak kullanacağınız ürünlerde kapatın. Ürün stok, reçete ve üretimde kullanılmaya devam eder.
                    </p>
                  </div>

                  {/* Price */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Satış Fiyatı *
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(event) =>
                        updateForm("price", event.target.value)
                      }
                      placeholder="0.00"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* Cost */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Maliyet Fiyatı
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.costPrice}
                      onChange={(event) =>
                        updateForm("costPrice", event.target.value)
                      }
                      placeholder="0.00"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* SKU */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      SKU
                    </label>

                    <input
                      value={form.sku}
                      onChange={(event) =>
                        updateForm("sku", event.target.value)
                      }
                      placeholder="ICECEK-COLA-330"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* Barcode */}
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Barkod
                    </label>

                    <input
                      value={form.barcode}
                      onChange={(event) =>
                        updateForm("barcode", event.target.value)
                      }
                      placeholder="8690000000000"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* Description */}
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">
                      Açıklama
                    </label>

                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(event) =>
                        updateForm("description", event.target.value)
                      }
                      placeholder="Ürün hakkında kısa açıklama..."
                      className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </div>

                {error && (
                  <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting || isUploadingImage}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  İptal
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingImage}
                  className="flex min-w-32 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(isSubmitting || isUploadingImage) && (
                    <Loader2 size={16} className="animate-spin" />
                  )}

                  {isUploadingImage
                    ? "Görsel Yükleniyor..."
                    : isSubmitting
                      ? "Kaydediliyor..."
                      : editingProduct
                        ? "Kaydet"
                        : "Ürün Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
