"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { QrCode, ExternalLink, Download, Copy } from "lucide-react";
import { api, button, secondary, input, panel, Notice } from "@/components/current-accounts/shared";
type Settings = { isPublished: boolean; serviceRequestsEnabled: boolean; waiterCallEnabled: boolean; billRequestEnabled: boolean; menuPath?: string };
type Table = { id: string; name: string; isActive: boolean; qrTokenRotatedAt: string | null };
const empty: Settings = { isPublished: false, serviceRequestsEnabled: false, waiterCallEnabled: false, billRequestEnabled: false };
const labels: Record<keyof Omit<Settings, "menuPath">, string> = { isPublished: "QR Menü yayında", serviceRequestsEnabled: "Servis talepleri aktif", waiterCallEnabled: "Garson Çağır aktif", billRequestEnabled: "Hesap İste aktif" };
export default function QrMenuManager({ branches }: { branches: { id: string; name: string }[] }) {
  const [branchId, setBranch] = useState(branches[0]?.id ?? ""), [settings, setSettings] = useState<Settings>(empty), [tables, setTables] = useState<Table[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState(""), [revision, refresh] = useState(0), [search, setSearch] = useState(""), [qr, setQr] = useState<{ image: string; url: string; title: string } | null>(null);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController();
    api<{ settings: Settings | null; tables: Table[] }>(`/api/qr-menu/${branchId}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setSettings(result.settings ?? empty); setTables(result.tables); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId, revision]);
  async function showQr(path: string, title: string) {
    const { toDataURL } = await import("qrcode"); const url = new URL(path, window.location.origin).href;
    setQr({ image: await toDataURL(url, { width: 360, margin: 4, errorCorrectionLevel: "M" }), url, title });
  }
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await api<Settings>(`/api/qr-menu/${branchId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(Object.keys(labels).map(key => [key, settings[key as keyof typeof labels]]))) }); setSettings(result); setMessage("QR Menü ayarları kaydedildi."); }
    catch (e) { setError(e instanceof Error ? e.message : "Ayarlar kaydedilemedi."); }
    finally { setBusy(false); }
  }
  async function tableQr(table: Table, revoke: boolean) {
    if ((revoke || table.qrTokenRotatedAt) && !window.confirm(revoke ? "Bu masanın mevcut QR kodu iptal edilsin mi?" : "Mevcut QR kodu geçersiz olacak. Yeni kod oluşturulsun mu?")) return;
    setBusy(true); setError(""); setMessage(""); setQr(null);
    try {
      const result = await api<{ menuPath: string | null }>(`/api/qr-menu/${branchId}/tables/${table.id}`, { method: revoke ? "DELETE" : "POST" });
      setTables(old => old.map(t => t.id === table.id ? { ...t, qrTokenRotatedAt: revoke ? null : new Date().toISOString() } : t));
      if (result.menuPath) await showQr(result.menuPath, table.name);
      setMessage(revoke ? "Masa QR kodu iptal edildi." : "Masa QR kodu hazır. Bağlantı yalnız bu işlemde gösterilir; şimdi indirin veya kopyalayın.");
    } catch (e) { setError(e instanceof Error ? e.message : "QR kodu oluşturulamadı. Gerekirse yeni kod üretin."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5"><header><h1 className="flex items-center gap-2 text-2xl font-bold"><QrCode/>QR Menü</h1><p className="mt-2 text-sm text-slate-500">Şube menüsünü yayınlayın, masalara özel QR kodlarıyla servis taleplerini açın.</p></header><Notice error={error} message={message}/>
    <section className={panel}><label className="block max-w-md text-sm">Şube<select className={input} value={branchId} disabled={busy} onChange={e => { setBranch(e.target.value); setMessage(""); setSearch(""); setLoading(true); setSettings(empty); setTables([]); setQr(null); setError(""); }}><option value="" disabled>Şube seçin</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{!branches.length && <p className="mt-4">Önce bir şube oluşturun.</p>}
    {branchId && <><div className="my-5 grid gap-4 sm:grid-cols-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm"><input type="checkbox" checked={settings[key]} disabled={busy || loading} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))}/>{labels[key]}</label>)}</div><p className="mb-4 text-xs text-slate-500">Menü mevcut aktif ve satılabilir ürünleri, kayıtlı satış fiyatlarıyla gösterir. Genel QR kodunda masa hizmetleri bulunmaz. Hesap İste için açık adisyon gerekir.</p><div className="flex flex-wrap gap-3"><button className={button} disabled={busy || loading} onClick={() => void save()}>Ayarları kaydet</button>{settings.menuPath && <><a className={secondary} href={settings.menuPath} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Menüyü aç</a><button className={secondary} disabled={busy || loading} onClick={() => void showQr(settings.menuPath!, "Şube genel menüsü").catch(() => setError("QR görseli üretilemedi."))}>Genel QR kodu</button></>}<button className={secondary} disabled={busy} onClick={() => { setLoading(true); setQr(null); refresh(v => v + 1); }}>Yenile</button></div></>}
    </section>
    {qr && <section className={panel + " flex flex-col items-center gap-3"}><h2 className="font-bold">{qr.title}</h2><Image unoptimized src={qr.image} alt={qr.title + " QR kodu"} width={300} height={300}/><p className="max-w-full break-all text-xs text-slate-500">{qr.url}</p><div className="flex flex-wrap gap-2"><a className={button} download="wellpos-masa-qr.png" href={qr.image}><Download size={16}/>PNG indir</a><button className={secondary} onClick={() => void navigator.clipboard.writeText(qr.url).then(() => setMessage("Bağlantı kopyalandı.")).catch(() => setError("Bağlantıyı yukarıdan elle kopyalayabilirsiniz."))}><Copy size={16}/>Bağlantıyı kopyala</button><a className={secondary} href={qr.url} target="_blank" rel="noreferrer">Menüyü aç</a></div><p className="text-xs text-amber-800">Masa QR bağlantısını gören herkes talep gönderebilir. Yalnız ilgili masada paylaşın.</p></section>}
    {branchId && <section className={panel}><h2 className="mb-3 text-lg font-bold">Masa QR kodları</h2><p className="mb-4 text-sm text-slate-500">Yeni kod üretmek eski basılı kodu geçersiz kılar. Kodlar sonradan tekrar gösterilmez; indirip saklayın.</p>{!loading && !settings.menuPath && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">QR kodu oluşturmak için önce yukarıdaki “Ayarları kaydet” düğmesine basın. Menü kapalıyken de kod hazırlayabilirsiniz; müşterilerin açabilmesi için menüyü yayınlamanız gerekir.</p>}<input className={input + " mb-4 max-w-md"} placeholder="Masa ara" aria-label="Masa ara" value={search} onChange={e => setSearch(e.target.value)}/>{loading ? <p>Masalar yükleniyor…</p> : !tables.length ? <p className="text-slate-500">Masalar ve Adisyonlar ekranından masa oluşturun.</p> : <div className="grid gap-3 md:grid-cols-2">{tables.filter(t => t.name.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))).map(t => <article key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-semibold">{t.name}</p><p className="text-xs text-slate-500">{!t.isActive ? "Pasif" : t.qrTokenRotatedAt ? "QR kodu mevcut" : "QR kodu yok"}</p></div><div className="flex gap-2"><button disabled={busy || loading || !t.isActive || !settings.menuPath} className={secondary} onClick={() => void tableQr(t, false)}>{t.qrTokenRotatedAt ? "Kodu yenile" : "QR oluştur"}</button>{t.qrTokenRotatedAt && <button className={secondary} disabled={busy} onClick={() => void tableQr(t, true)}>İptal et</button>}</div></article>)}</div>}{tables.length === 500 && <p className="mt-4 text-sm text-amber-800">İlk 500 masa gösteriliyor.</p>}</section>}
  </div>;
}
