
"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Plus,
  Pencil,
  X,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Armchair,
} from "lucide-react";

type Branch = {
  id: string;
  name: string;
  createdAt: string;
  _count: {
    orders: number;
    restaurantTables: number;
  };
};

type Props = {
  canManage: boolean;
  canCreate: boolean;
};

export default function BranchManager({
  canManage,
  canCreate,
}: Props) {
  const router = useRouter();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] =
    useState<Branch | null>(null);
  const [name, setName] = useState("");

  const fetchBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/branches", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Şubeler alınamadı.");
      }

      setBranches(data.branches ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Şubeler yüklenemedi."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void fetchBranches(); });
    return () => { active = false; };
  }, [fetchBranches]);

  function openCreateModal() {
    setEditingBranch(null);
    setName("");
    setError("");
    setSuccess("");
    setShowModal(true);
  }

  function openEditModal(branch: Branch) {
    setEditingBranch(branch);
    setName(branch.name);
    setError("");
    setSuccess("");
    setShowModal(true);
  }

  function closeModal() {
    if (saving) return;

    setShowModal(false);
    setEditingBranch(null);
    setName("");
  }

  async function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage || (!editingBranch && !canCreate) || saving) return;

    const normalizedName = name.trim();

    if (normalizedName.length < 2 || normalizedName.length > 100) {
      setError("Şube adı 2-100 karakter olmalıdır.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const editing = editingBranch !== null;

      const url = editing
        ? `/api/branches/${editingBranch.id}`
        : "/api/branches";

      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "İşlem başarısız.");
      }

      setShowModal(false);
      setEditingBranch(null);
      setName("");

      setSuccess(
        editing
          ? "Şube başarıyla güncellendi."
          : "Yeni şube başarıyla oluşturuldu."
      );

      await fetchBranches();

      // Dashboard şube seçicisinin verilerini yenile
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "İşlem sırasında hata oluştu."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">
            Şube Yönetimi
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            İşletmenize ait şubeleri görüntüleyin ve yönetin.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchBranches()}
            disabled={loading}
            title="Yenile"
            className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>

          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={18} />
              Yeni Şube
            </button>
          )}
        </div>
      </div>

      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
        >
          {success}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">
            Toplam Şube
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-950">
            {branches.length}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">
            Toplam Masa
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-950">
            {branches.reduce(
              (sum, branch) =>
                sum + branch._count.restaurantTables,
              0
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">
            Toplam Satış Kaydı
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-950">
            {branches.reduce(
              (sum, branch) =>
                sum + branch._count.orders,
              0
            )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-16 text-slate-500">
          <Loader2 className="animate-spin" />
          Şubeler yükleniyor...
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Building2
            size={36}
            className="mx-auto text-slate-300"
          />
          <p className="mt-4 text-sm text-slate-500">
            Henüz şube bulunmuyor.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Building2 size={24} />
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={() => openEditModal(branch)}
                    className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                    title="Şubeyi düzenle"
                  >
                    <Pencil size={17} />
                  </button>
                )}
              </div>

              <h2 className="mt-5 text-lg font-bold text-slate-950">
                {branch.name}
              </h2>

              <p className="mt-1 text-xs text-slate-400">
                Oluşturulma:{" "}
                {new Date(branch.createdAt).toLocaleDateString(
                  "tr-TR"
                )}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Armchair size={17} />
                  {branch._count.restaurantTables} masa
                </div>

                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <ShoppingBag size={17} />
                  {branch._count.orders} satış
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-modal-title"
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h2
                id="branch-modal-title"
                className="text-lg font-bold text-slate-950"
              >
                {editingBranch
                  ? "Şubeyi Düzenle"
                  : "Yeni Şube Oluştur"}
              </h2>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={saveBranch} className="space-y-5 p-5">
              <div>
                <label
                  htmlFor="branch-name"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Şube Adı
                </label>

                <input
                  id="branch-name"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  maxLength={100}
                  minLength={2}
                  required
                  placeholder="Örn: Kadıköy Şubesi"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  Vazgeç
                </button>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    name.trim().length < 2 ||
                    name.trim().length > 100
                  }
                  className="flex-1 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving
                    ? "Kaydediliyor..."
                    : editingBranch
                      ? "Kaydet"
                      : "Şube Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
