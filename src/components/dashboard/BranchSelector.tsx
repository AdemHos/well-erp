
"use client";

import { useState } from "react";
import { confirmSettingsNavigation } from "@/lib/settings-navigation";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

type Branch = {
  id: string;
  name: string;
};

type BranchSelectorProps = {
  branches: Branch[];
  activeBranchId: string | null;
};

export default function BranchSelector({
  branches,
  activeBranchId,
}: BranchSelectorProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeBranch = branches.find(
    (branch) => branch.id === activeBranchId
  );

  async function selectBranch(branchId: string) {
    if (branchId === activeBranchId || loading) {
      setOpen(false);
      return;
    }

    if (!confirmSettingsNavigation()) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/branches/active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ branchId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Şube değiştirilemedi."
        );
      }

      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Şube değiştirilemedi."
      );
    } finally {
      setLoading(false);
    }
  }

  if (branches.length === 0) {
    return (
      <p className="text-xs text-red-500">
        Şube bulunamadı
      </p>
    );
  }

  if (branches.length === 1) {
    return (
      <p className="text-xs text-slate-500">
        {branches[0].name}
      </p>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={loading}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50"
      >
        <span>
          {loading
            ? "Şube değiştiriliyor..."
            : activeBranch?.name || "Şube seç"}
        </span>

        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-3 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <p className="px-3 py-2 text-xs font-semibold text-slate-400">
            ŞUBE SEÇ
          </p>

          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => void selectBranch(branch.id)}
              disabled={loading}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <span>{branch.name}</span>

              {branch.id === activeBranchId && (
                <Check
                  size={16}
                  className="text-green-600"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
