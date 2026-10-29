"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

type Category = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    products: number;
  };
};

type CategoryManagerProps = {
  initialCategories: Category[];
};

export default function CategoryManager({
  initialCategories,
}: CategoryManagerProps) {
  const [categories, setCategories] =
    useState<Category[]>(initialCategories);

  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [editingCategory, setEditingCategory] =
    useState<Category | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const filteredCategories = useMemo(() => {
    return categories.filter((category) =>
      category.name.toLocaleLowerCase("tr-TR").includes(
        search.toLocaleLowerCase("tr-TR")
      )
    );
  }, [categories, search]);

  function openCreateModal() {
    setEditingCategory(null);
    setName("");
    setError("");
    setIsModalOpen(true);
  }

  function openEditModal(category: Category) {
    setEditingCategory(category);
    setName(category.name);
    setError("");
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSubmitting) return;

    setIsModalOpen(false);
    setEditingCategory(null);
    setName("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Kategori adı zorunludur.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const url = editingCategory
        ? `/api/categories/${editingCategory.id}`
        : "/api/categories";

      const response = await fetch(url, {
        method: editingCategory ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Bir hata oluştu.");
        return;
      }

      if (editingCategory) {
        setCategories((current) =>
          current.map((category) =>
            category.id === editingCategory.id
              ? {
                  ...category,
                  ...data.category,
                }
              : category
          )
        );
      } else {
        setCategories((current) => [
          {
            ...data.category,
            _count: {
              products: 0,
            },
          },
          ...current,
        ]);
      }

      closeModal();
    } catch (error) {
      console.error(error);
      setError("Sunucuya bağlanırken bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(category: Category) {
    if (category._count.products > 0) {
      const confirmed = window.confirm(
        `"${category.name}" kategorisinde ${category._count.products} ürün bulunuyor. Kategori silinirse ürünler kategorisiz kalacak. Devam etmek istiyor musunuz?`
      );

      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `"${category.name}" kategorisini silmek istediğinizden emin misiniz?`
      );

      if (!confirmed) return;
    }

    try {
      setDeletingId(category.id);

      const response = await fetch(
        `/api/categories/${category.id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        window.alert(data.error || "Kategori silinemedi.");
        return;
      }

      setCategories((current) =>
        current.filter((item) => item.id !== category.id)
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
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kategori ara..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <Plus size={17} />
            Yeni Kategori
          </button>
        </div>

        {/* Table */}
        {filteredCategories.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <FolderOpen size={25} />
            </div>

            <h3 className="mt-4 font-semibold text-slate-800">
              {categories.length === 0
                ? "Henüz kategori bulunmuyor"
                : "Kategori bulunamadı"}
            </h3>

            <p className="mt-1 max-w-sm text-sm text-slate-500">
              {categories.length === 0
                ? "Ürünlerinizi düzenlemek için ilk kategorinizi oluşturabilirsiniz."
                : "Arama kriterinize uygun bir kategori bulunamadı."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Kategori
                  </th>

                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Ürün Sayısı
                  </th>

                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    İşlemler
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredCategories.map((category) => (
                  <tr
                    key={category.id}
                    className="transition hover:bg-slate-50/70"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <FolderOpen size={17} />
                        </div>

                        <span className="text-sm font-semibold text-slate-800">
                          {category.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {category._count.products} ürün
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(category)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                          title="Düzenle"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          disabled={deletingId === category.id}
                          onClick={() => handleDelete(category)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Sil"
                        >
                          {deletingId === category.id ? (
                            <Loader2
                              size={16}
                              className="animate-spin"
                            />
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

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="font-semibold text-slate-950">
                  {editingCategory
                    ? "Kategoriyi Düzenle"
                    : "Yeni Kategori"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {editingCategory
                    ? "Kategori adını güncelleyin."
                    : "Ürünleriniz için yeni bir kategori oluşturun."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <label className="text-sm font-medium text-slate-700">
                Kategori Adı
              </label>

              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Örn. İçecekler"
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              {error && (
                <p className="mt-2 text-sm text-red-600">
                  {error}
                </p>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  İptal
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex min-w-24 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  )}

                  {editingCategory ? "Kaydet" : "Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}