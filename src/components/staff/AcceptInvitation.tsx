"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function AcceptInvitation({ email }: { email: string | null }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { queueMicrotask(() => setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "")); }, []);
  async function accept() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/staff/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Davet kabul edilemedi.");
      window.history.replaceState(null, "", "/invite"); router.replace("/dashboard"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Davet kabul edilemedi."); setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 p-6"><h1 className="text-2xl font-bold">İşletme Daveti</h1><p className="text-sm text-slate-600">Bu bağlantı 72 saat geçerlidir ve yalnızca davet edilen hesapla bir kez kabul edilebilir.</p>
    {email ? <><p className="text-sm">Giriş yapılan hesap: <strong>{email}</strong></p><button disabled={busy || !token} onClick={() => void accept()} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Kabul ediliyor…" : "Daveti Kabul Et"}</button></> : <><p className="text-sm">Davet edilen e-posta ile giriş yapın veya hesap oluşturun. Ardından size iletilen davet bağlantısını yeniden açın.</p><div className="flex gap-4"><Link href="/login" className="text-blue-600 underline">Giriş Yap</Link><Link href="/register" className="text-blue-600 underline">Hesap Oluştur</Link></div></>}
    {email && !token && <p className="text-sm text-amber-700">Davet bağlantısının tamamını açtığınızdan emin olun.</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</main>;
}
