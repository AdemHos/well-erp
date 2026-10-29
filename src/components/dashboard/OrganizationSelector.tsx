"use client";
import { useState } from "react";
import { confirmSettingsNavigation } from "@/lib/settings-navigation";
import { useRouter } from "next/navigation";
export default function OrganizationSelector({ organizations, activeId }: { organizations: { id: string; name: string }[]; activeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function select(id: string) {
    if (!confirmSettingsNavigation()) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/organizations/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.push("/dashboard"); router.refresh(); setBusy(false); }
    catch (err) { setError(err instanceof Error ? err.message : "İşletme değiştirilemedi."); setBusy(false); }
  }
  return <div><label className="sr-only" htmlFor="active-organization">Aktif işletme</label><select id="active-organization" value={activeId} disabled={busy} onChange={(event) => void select(event.target.value)} className="max-w-40 rounded border border-slate-200 bg-white p-1 text-xs text-slate-800"><option value="" disabled>İşletme seçin</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}</div>;
}
