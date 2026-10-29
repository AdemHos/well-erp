"use client";
import { useState } from "react";
import { BellRing, Receipt } from "lucide-react";
import type { publicMenu } from "@/lib/qr-service";
type Menu = Awaited<ReturnType<typeof publicMenu>>;
export default function PublicMenu({ menu, publicToken, tableToken }: { menu: Menu; publicToken: string; tableToken: string | null }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function request(type: "WAITER_CALL" | "BILL_REQUEST") {
    if (busy || !tableToken) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/menu/${publicToken}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, tableToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? result.message ?? "Talep iletilemedi.");
      setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Talep iletilemedi. Lütfen tekrar deneyin."); }
    finally { setBusy(false); }
  }
  const categories = [...new Set(menu.products.map(p => p.category))];
  return <main className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8 text-slate-900">
    <header className="rounded-3xl bg-slate-950 p-7 text-white"><p className="text-sm text-slate-300">{menu.branchName}</p><h1 className="mt-1 text-3xl font-bold">{menu.organizationName}</h1><p className="mt-3">{menu.tableName ? `${menu.tableName} · Menü` : "Menü"}</p></header>
    {menu.invalidTable && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">Masa bağlantısı geçersiz veya masa kullanım dışı. Menüye göz atabilirsiniz; servis talebi için personelimizle görüşün.</p>}
    {(menu.waiterCallEnabled || menu.billRequestEnabled) && <section aria-label="Masa hizmetleri" className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="flex flex-wrap gap-3">
      {menu.waiterCallEnabled && <button disabled={busy} onClick={() => void request("WAITER_CALL")} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50"><BellRing size={19}/>Garson Çağır</button>}
      {menu.billRequestEnabled && <button disabled={busy || !menu.hasOpenTab} onClick={() => void request("BILL_REQUEST")} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 font-semibold text-blue-900 disabled:opacity-50"><Receipt size={19}/>Hesap İste</button>}
    </div>{menu.billRequestEnabled && !menu.hasOpenTab && <p className="text-sm text-slate-600">Bu masada açık adisyon bulunmuyor. Hesap talebi için personelimizle görüşün.</p>}<p className="text-xs text-slate-500">Hesap istemek ödeme yapmaz; personelimize haber verir.</p></section>}
    <div role="status" aria-live="polite">{message && <p className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{message}</p>}</div>{error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {!menu.products.length && <p className="rounded-2xl border p-8 text-center text-slate-500">Menüye henüz ürün eklenmemiş.</p>}
    {categories.map(category => <section key={category}><h2 className="mb-3 text-xl font-bold">{category}</h2><div className="space-y-3">{menu.products.filter(p => p.category === category).map(p => <article key={p.id} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div><h3 className="font-semibold">{p.name}</h3>{p.description && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{p.description}</p>}</div><p className="shrink-0 font-semibold">{new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(p.price))}</p></article>)}</div></section>)}
    <footer className="py-6 text-center text-xs text-slate-400">WellPOS QR Menü</footer>
  </main>;
}
