"use client";

import { useEffect, useRef, useState } from "react";
import type { PrinterSettings } from "@/lib/integrations";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";

export type ReceiptOrder = {
  id: string;
  businessSnapshot?: { name: string; legalName?: string | null; phone?: string | null; address?: string | null; taxOffice?: string | null; taxNumber?: string | null } | null;
  customerSnapshot?: { name: string; code: string; type: string } | null;
  status?: "COMPLETED" | "CANCELLED" | "REFUNDED";
  orderNumber: string;
  createdAt: string;
  organization: { name: string };
  branch: { id?: string; name: string };
  paymentMethod: "CASH" | "CARD";
  subtotal: string;
  discountType: "PERCENT" | "FIXED" | null;
  discountValue: string;
  discountAmount: string;
  total: string;
  items: {
    id: string;
    productName: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }[];
};

type PaperWidth = "58" | "80";

const money = (value: string) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));

const quantity = (value: string) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value));

export function ReceiptContent({ order, showCustomer = false, settings }: { order: ReceiptOrder; showCustomer?: boolean; settings?: PrinterSettings }) {
  const date = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date(order.createdAt));

  return (
    <article aria-label="Satış fişi">
      <header>
        {settings?.showOrganization !== false && <h1>{order.businessSnapshot?.name ?? order.organization.name}</h1>}
        {settings?.showBranch !== false && <p>{order.branch.name}</p>}
        {settings?.receiptHeader && <p style={{ whiteSpace: "pre-wrap" }}>{settings.receiptHeader}</p>}
        <p className="receipt-title">SATIŞ FİŞİ</p>
        {order.status === "REFUNDED" && <p>İADE EDİLMİŞ SATIŞ — ORİJİNAL FİŞ</p>}
        {order.status === "CANCELLED" && <p>İPTAL EDİLMİŞ SATIŞ — ORİJİNAL FİŞ</p>}
      </header>
      <section className="receipt-meta">
        <p>Satış No: {order.orderNumber}</p>
        <p>Tarih: {date}</p>
        {showCustomer && order.customerSnapshot && <p>Müşteri: {order.customerSnapshot.name} · {order.customerSnapshot.code}</p>}
      </section>
      <section className="receipt-items" aria-label="Ürünler">
        {order.items.map((item) => (
          <div className="receipt-item" key={item.id}>
            <p className="receipt-product">{item.productName}</p>
            <div className="receipt-row">
              <span>{quantity(item.quantity)} × {money(item.unitPrice)}</span>
              <strong>{money(item.total)}</strong>
            </div>
          </div>
        ))}
      </section>
      <section className="receipt-totals">
        <div className="receipt-row"><span>Ara toplam</span><span>{money(order.subtotal)}</span></div>
        {order.discountType && (
          <div className="receipt-row">
            <span>İndirim ({order.discountType === "PERCENT"
              ? `%${quantity(order.discountValue)}`
              : money(order.discountValue)})</span>
            <span>−{money(order.discountAmount)}</span>
          </div>
        )}
        <div className="receipt-row receipt-total"><strong>TOPLAM</strong><strong>{money(order.total)}</strong></div>
        <div className="receipt-row"><span>Ödeme</span><span>{order.paymentMethod === "CASH" ? "Nakit" : "Kart"}</span></div>
      </section>
      <footer>
        <p style={{ whiteSpace: "pre-wrap" }}>{settings?.receiptFooter ?? "Teşekkür ederiz. Yine bekleriz!"}</p>
        <p>Bilgilendirme amaçlı satış fişidir.<br />Mali fiş veya e-Arşiv fatura değildir.</p>
      </footer>
    </article>
  );
}

// Only the constrained paper width enters this HTML. All sale data is rendered
// by React into the iframe, so names and other user data remain escaped text.
function printDocument(width: PaperWidth) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Satış Fişi</title>
    <style>
      @page { size: auto; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: ${width}mm; background: white; color: black; }
      body { padding: 3mm; font: ${width === "58" ? "11" : "12"}px/1.4 Arial, sans-serif; }
      h1 { margin: 0 0 2mm; font-size: 17px; }
      p { margin: 0; overflow-wrap: anywhere; }
      header, footer { text-align: center; }
      header, .receipt-meta, .receipt-item, .receipt-totals, footer { break-inside: avoid; }
      .receipt-title { margin-top: 3mm; font-weight: bold; }
      .receipt-meta, .receipt-items, .receipt-totals { border-top: 1px dashed black; margin-top: 3mm; padding-top: 3mm; }
      .receipt-item + .receipt-item { margin-top: 2mm; }
      .receipt-product { font-weight: bold; }
      .receipt-row { display: flex; justify-content: space-between; gap: 2mm; margin-top: 1mm; }
      .receipt-row > :first-child { min-width: 0; overflow-wrap: anywhere; }
      .receipt-row > :last-child { flex-shrink: 0; text-align: right; }
      .receipt-total { border-top: 1px dashed black; padding-top: 2mm; margin-top: 2mm; font-size: 15px; }
      footer { margin-top: 4mm; }
      footer p + p { margin-top: 3mm; font-size: 9px; }
    </style></head><body></body></html>`;
}

function ReceiptPrinter({ order, width, showCustomer, settings, autoPrint = false }: { order: ReceiptOrder; width: PaperWidth; showCustomer: boolean; settings?: PrinterSettings; autoPrint?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [printBody, setPrintBody] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const automaticAttempt = useRef(false);
  useEffect(() => {
    if (!autoPrint || !printBody || automaticAttempt.current) return;
    let cancelled = false;
    void printBody.ownerDocument.fonts.ready.then(() => {
      if (cancelled || automaticAttempt.current) return;
      automaticAttempt.current = true;
      try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }
      catch { setError("Yazdırma penceresi açılamadı. Fiş Yazdır düğmesiyle tekrar deneyin."); }
    });
    return () => { cancelled = true; };
  }, [autoPrint, printBody]);

  async function print() {
    const target = frame.current?.contentWindow;
    if (!target || !printBody) return;
    setError("");
    try {
      await printBody.ownerDocument.fonts.ready;
      target.focus();
      target.print();
    } catch {
      setError("Yazdırma penceresi açılamadı. Tarayıcı izinlerini kontrol edip tekrar deneyin.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => void print()} disabled={!printBody}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
        <Printer size={16} /> Fiş Yazdır
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <iframe ref={frame} title="Son satışın yazdırma görünümü" aria-hidden="true" tabIndex={-1}
        srcDoc={printDocument(width)}
        onLoad={() => setPrintBody(frame.current?.contentDocument?.body ?? null)}
        style={{ position: "fixed", left: "-10000px", top: 0, width: `${width}mm`, height: 0, border: 0 }} />
      {printBody && createPortal(<ReceiptContent order={order} showCustomer={showCustomer} settings={settings} />, printBody)}
    </>
  );
}

type SaleReceiptProps = { order: ReceiptOrder; title?: string; showRetentionHint?: boolean; branchId?: string; settingsOverride?: PrinterSettings; allowAutoPrint?: boolean };
export default function SaleReceipt(props: SaleReceiptProps) {
  return <ConfiguredReceipt key={`${props.order.id}-${props.branchId ?? props.order.branch.id ?? ""}`} {...props}/>;
}
function ConfiguredReceipt({ order, title = "Son satışın fişi", showRetentionHint = true, branchId, settingsOverride, allowAutoPrint = false }: SaleReceiptProps) {
  const [showCustomer, setShowCustomer] = useState(false);
  const [settings, setSettings] = useState<PrinterSettings | undefined>(settingsOverride);
  const [loaded, setLoaded] = useState(!!settingsOverride || !(branchId ?? order.branch.id));
  const [settingsError, setSettingsError] = useState("");
  const [width, setWidth] = useState<PaperWidth>(settingsOverride?.paperWidth ?? "80");
  const [manualWidth, setManualWidth] = useState(false);
  const settingsBranchId = branchId ?? order.branch.id;
  useEffect(() => {
    if (settingsOverride) return;
    if (!settingsBranchId) return;
    const controller = new AbortController();
    fetch(`/api/integrations/printer/${encodeURIComponent(settingsBranchId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) { setSettings(data.settings); setWidth(data.settings.paperWidth); } })
      .catch(() => { if (!controller.signal.aborted) setSettingsError("Şube yazıcı ayarları yüklenemedi. Varsayılan fiş ayarları kullanılıyor."); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [settingsBranchId, settingsOverride]);

  return (
    <section aria-label={title} className="mx-5 mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 break-all text-xs text-slate-500">{order.orderNumber}</p>
      <label className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-700">
        Kağıt genişliği
        <select value={width} onChange={(event) => { setManualWidth(true); setWidth(event.target.value === "58" ? "58" : "80"); }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <option value="58">58 mm</option>
          <option value="80">80 mm</option>
        </select>
      </label>
      {order.customerSnapshot && <label className="mt-3 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={showCustomer} onChange={e => setShowCustomer(e.target.checked)}/>Müşteri adını ve kodunu fişte göster</label>}
      {settingsError && <p role="status" className="mt-2 text-xs text-amber-700">{settingsError}</p>}
      {loaded && <ReceiptPrinter key={`${order.id}-${width}`} width={width} order={order} showCustomer={showCustomer} settings={settings} autoPrint={allowAutoPrint && !manualWidth && settings?.afterSalePrint === "OPEN_DIALOG"} />}
      <p className="mt-2 text-xs text-slate-500">Tarayıcı yazdırma penceresi kullanılır; sessiz yazdırma ve fiziksel cihaz bağlantısı desteklenmez.</p>
      <p className="mt-2 text-xs text-slate-500">Yazdırma penceresinde aynı kağıt boyutunu seçin; ölçeği %100 yapıp üst ve alt bilgileri kapatın.</p>
      {showRetentionHint && <p className="mt-2 text-xs text-slate-500">Fişi yazdırmadan yeni satışa başlayabilirsiniz. Son fiş, sayfa yenilenene veya yeni satış tamamlanana kadar tekrar yazdırılabilir.</p>}
    </section>
  );
}
