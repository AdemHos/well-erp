"use client";
import BrandLogo from "@/components/BrandLogo";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "@/components/landing/auth/LogoutButton";
type Profile = { id: string; name: string; role: string; needsSetup: boolean; isOwn: boolean };
export const roleLabels: Record<string, string> = { OWNER: "İşletme Sahibi", ADMIN: "Yönetici", MANAGER: "Müdür", CASHIER: "Kasiyer", WAITER: "Garson", KITCHEN: "Mutfak", STAFF: "Personel" };
export default function ProfilePicker() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]); const [organization, setOrganization] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null); const [pin, setPin] = useState(""); const [password, setPassword] = useState("");
  const [resetOwnPin, setResetOwnPin] = useState(false);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const locked = await fetch("/api/profile-session", { method: "DELETE" });
        if (!locked.ok) { const data = await locked.json(); throw new Error(data.error); }
        const response = await fetch("/api/profile-session", { cache: "no-store" }); const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) { setProfiles(data.profiles); setOrganization(data.organizationName); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : "Profiller alınamadı."); }
      finally { if (active) setBusy(false); }
    }
    void load(); return () => { active = false; };
  }, []);
  async function enter(event: FormEvent) {
    event.preventDefault(); if (!selected || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: selected.id, pin, password, resetOwnPin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPin(""); setPassword(""); router.replace("/dashboard"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Profil açılamadı."); setPin(""); }
    finally { setBusy(false); }
  }
  return <main className="relative isolate flex min-h-screen items-center justify-center bg-slate-900 px-5 py-12 text-white">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1e40af_0%,_transparent_65%)]" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/80" />
    <section className="relative z-10 w-full max-w-4xl space-y-8 text-center">
    <BrandLogo variant="dark" className="mx-auto h-20 w-30" />
    <div><p className="text-sm text-slate-300">{organization || "WellPOS"}</p><h1 className="mt-3 text-3xl font-bold">Kim kullanıyor?</h1><p className="mt-3 text-sm text-slate-400">Personel profilinizi seçip PIN ile devam edin.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-sm text-red-200">{error}</p>}
    {busy && !selected && <p>Profiller yükleniyor…</p>}
    {!selected ? <div className="flex flex-wrap justify-center gap-5">{profiles.map((profile, index) => <button disabled={busy} key={profile.id} onClick={() => { setSelected(profile); setResetOwnPin(false); setError(""); setPin(""); setPassword(""); }} className="group w-28 rounded-xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold ring-white/80 ring-offset-4 ring-offset-black transition group-hover:ring-2 group-focus-visible:ring-2 sm:h-20 sm:w-20 ${["bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-amber-600"][index % 4]}`}>{profile.name.charAt(0).toLocaleUpperCase("tr")}</span><span className="mt-3 block break-words text-sm font-medium">{profile.name}</span><span className="mt-1 block text-xs text-slate-400">{roleLabels[profile.role]}</span></button>)}</div> : <form onSubmit={enter} className="mx-auto max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-left">
      <h2 className="text-xl font-semibold">{selected.name}</h2><p className="text-sm text-slate-400">{selected.needsSetup ? "Bu hesap için 6 haneli yeni PIN belirleyin. İlk kurulumda hesap şifreniz gerekir; Google hesabında son 5 dakika içinde giriş yapılmış olmalıdır." : "6 haneli personel PIN'inizi girin."}</p>
      <label className="block text-sm">{selected.needsSetup ? "Yeni PIN" : "PIN"}<input autoFocus required type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 p-3 tracking-widest" /></label>
      {selected.needsSetup && <label className="block text-sm">Hesap şifresi (Google girişinde boş bırakın)<input type="password" autoComplete="current-password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 p-3" /></label>}
      {selected.isOwn && !selected.needsSetup && <button type="button" className="text-sm text-blue-300" onClick={() => { setResetOwnPin(true); setSelected({ ...selected, needsSetup: true }); setPin(""); setError(""); }}>PIN belirle / PIN unuttum</button>}
      <button disabled={busy} className="w-full rounded-lg bg-blue-600 p-3 font-semibold disabled:opacity-50">{busy ? "Doğrulanıyor…" : "Devam Et"}</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setPin(""); setPassword(""); setError(""); }} className="w-full p-2 text-sm text-slate-400">Geri</button>
    </form>}
    <div className="flex justify-center"><LogoutButton className="flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400" /></div>
  </section></main>;
}
