"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingForm() {
  const router = useRouter();

  const [organizationName, setOrganizationName] = useState("");
  const [branchName, setBranchName] = useState("Merkez Şube");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          organizationName: organizationName.trim(),
          branchName: branchName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "İşletme oluşturulamadı.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("ONBOARDING_ERROR:", error);

      setError("İşletme oluşturulurken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      {/* Organization Name */}
      <div>
        <label
          htmlFor="organizationName"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          İşletme Adı
        </label>

        <input
          id="organizationName"
          type="text"
          required
          autoFocus
          value={organizationName}
          onChange={(event) =>
            setOrganizationName(event.target.value)
          }
          placeholder="Örn: Well Cafe"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
        />

        <p className="mt-2 text-xs text-slate-400">
          İşletmenizin müşteriler ve personel tarafından görülecek adı.
        </p>
      </div>

      {/* Branch Name */}
      <div>
        <label
          htmlFor="branchName"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Ana Şube
        </label>

        <input
          id="branchName"
          type="text"
          required
          value={branchName}
          onChange={(event) =>
            setBranchName(event.target.value)
          }
          placeholder="Örn: Merkez Şube"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
        />

        <p className="mt-2 text-xs text-slate-400">
          Daha sonra işletmenize yeni şubeler ekleyebilirsiniz.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading
          ? "İşletme oluşturuluyor..."
          : "İşletmemi Oluştur"}
      </button>
    </form>
  );
}