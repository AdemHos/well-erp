"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plug, Printer } from "lucide-react";
import { defaultPrinterSettings, integrationCatalog, integrationCategories, type PrinterSettings } from "@/lib/integrations";
import SaleReceipt, { type ReceiptOrder } from "@/components/pos/SaleReceipt";

type Props = { branches: { id: string; name: string }[]; organizationName: string; canManage: boolean };
const control = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50";
export default function IntegrationsManager({ branches, organizationName, canManage }: Props) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [settings, setSettings] = useState<PrinterSettings>({ ...defaultPrinterSettings });
  const [loading, setLoading] = useState(!!branches.length), [saving, setSaving] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [testOrder, setTestOrder] = useState<ReceiptOrder | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!branchId) return () => controller.abort();
    fetch(`/api/integrations/printer/${encodeURIComponent(branchId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => { if (!controller.signal.aborted) { setSettings(data.settings); setReady(data.storageReady); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Ayarlar yüklenemedi."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId]);
  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/integrations/printer/${encodeURIComponent(branchId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSettings(data.settings); setMessage("Şube yazıcı ayarları kaydedildi.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ayarlar kaydedilemedi."); }
    finally { setSaving(false); }
  }
  function createTest() {
    setTestOrder({ id: "test-" + Date.now(), orderNumber: "TEST FİŞİ — SATIŞ DEĞİLDİR", createdAt: new Date().toISOString(), organization: { name: organizationName }, branch: { name: branches.find(b => b.id === branchId)?.name ?? "" }, paymentMethod: "CASH", subtotal: "10", discountType: null, discountValue: "0", discountAmount: "0", total: "10", items: [{ id: "test", productName: "Örnek ürün — test çıktısı", quantity: "1", unitPrice: "10", total: "10" }] });
  }
  return <div className="mx-auto max-w-6xl space-y-7 p-4 md:p-8">
    <header><div className="flex items-center gap-3"><Plug className="text-blue-600"/><h1 className="text-2xl font-bold text-slate-900">Entegrasyonlar</h1></div><p className="mt-2 text-sm text-slate-500">Cihaz özelliklerini ve planlanan harici servisleri yönetin.</p></header>
    {integrationCategories.map(category => <section key={category} aria-label={category}><h2 className="mb-3 text-lg font-semibold">{category}</h2><div className="grid gap-4 md:grid-cols-2">{integrationCatalog.filter(item => item.category === category).map(item => <article key={item.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">{item.name}</h3><span className={`rounded-full px-3 py-1 text-xs ${item.support === "AVAILABLE" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{item.support === "AVAILABLE" ? "Kullanılabilir" : "Yakında"}</span></div><p className="mt-2 text-xs text-slate-500">{item.category}</p><p className="my-3 text-sm text-slate-600">{item.description}</p><p className="text-xs text-slate-500">Bağlantı: Bağlı değil</p><p className="mt-1 text-xs text-slate-500">{item.connectionNote}</p><div className="mt-auto pt-4">{item.id === "printer" ? <a className={control + " inline-block"} href="#printer-settings">Ayarlar</a> : item.id === "barcode" ? <Link className={control + " inline-block"} href="/dashboard/pos">POS ekranını aç</Link> : <button className={control} disabled title="Bu entegrasyon henüz uygulanmadı.">Ayarlar · Yakında</button>}</div></article>)}</div></section>)}
    <section id="printer-settings" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 text-lg font-semibold"><Printer size={20}/>Şube yazıcı ayarları</h2>
      <p className="my-3 text-sm text-slate-500">Tarayıcının yazdırma penceresi kullanılır. Fiziksel yazıcı keşfi, bağlantı testi ve sessiz otomatik yazdırma desteklenmez. Test fişi satış, stok veya finans kaydı oluşturmaz.</p>
      {!branches.length ? <p role="status">Yetkili olduğunuz şube bulunamadı.</p> : <>
        <label className="grid max-w-sm gap-1 text-sm">Şube<select className={control} value={branchId} disabled={saving} onChange={e => { setLoading(true); setReady(false); setError(""); setMessage(""); setTestOrder(null); setBranchId(e.target.value); }}>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        {loading && <p className="mt-4" role="status">Ayarlar yükleniyor…</p>}
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        {message && <p className="mt-4 text-sm text-green-700" role="status">{message}</p>}
        {!loading && !ready && !error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Veritabanı güncellemesi henüz uygulanmadı. Varsayılan fiş ayarları kullanılıyor; kaydetme devre dışı. Migration öncesinde Neon yedeği alınmalıdır.</p>}
        {!canManage && <p className="mt-4 text-sm text-slate-500">Ayarları yalnızca OWNER ve yetkili ADMIN değiştirebilir.</p>}
        <fieldset disabled={loading || saving || !canManage || !!error} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Kağıt genişliği<select className={control} value={settings.paperWidth} onChange={e => { setSettings(s => ({ ...s, paperWidth: e.target.value as PrinterSettings["paperWidth"] })); setTestOrder(null); }}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
          <label className="grid gap-1 text-sm">Satış sonrası yazdırma<select className={control} value={settings.afterSalePrint} onChange={e => setSettings(s => ({ ...s, afterSalePrint: e.target.value as PrinterSettings["afterSalePrint"] }))}><option value="MANUAL">Manuel — Fiş Yazdır düğmesi</option><option value="OPEN_DIALOG">Yazdırma penceresini aç</option></select></label>
          <label className="grid gap-1 text-sm">Fiş başlığı (en fazla 160 karakter)<textarea className={control} maxLength={160} value={settings.receiptHeader} onChange={e => { setSettings(s => ({ ...s, receiptHeader: e.target.value })); setTestOrder(null); }}/></label>
          <label className="grid gap-1 text-sm">Fiş alt mesajı (en fazla 300 karakter)<textarea className={control} maxLength={300} value={settings.receiptFooter} onChange={e => { setSettings(s => ({ ...s, receiptFooter: e.target.value })); setTestOrder(null); }}/></label>
        </fieldset>
        <fieldset disabled={loading || saving || !canManage || !!error} className="mt-4 flex flex-wrap gap-4 text-sm">{(["showOrganization", "showBranch"] as const).map(key => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key]} onChange={e => { setSettings(s => ({ ...s, [key]: e.target.checked })); setTestOrder(null); }}/>{key === "showOrganization" ? "İşletme bilgisini göster" : "Şube bilgisini göster"}</label>)}</fieldset>
        <div className="mt-4 flex gap-3"><button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!ready || loading || saving || !canManage || !!error} onClick={() => void save()}>{saving ? "Kaydediliyor…" : "Ayarları kaydet"}</button><button className={control} disabled={loading || saving || !!error} onClick={createTest}>Test fişi oluştur</button></div>
        {testOrder && <div className="mt-4"><SaleReceipt key={testOrder.id} order={testOrder} settingsOverride={{ ...settings, afterSalePrint: "MANUAL" }} title="Test fişi" showRetentionHint={false}/></div>}
      </>}
    </section>
  </div>;
}
