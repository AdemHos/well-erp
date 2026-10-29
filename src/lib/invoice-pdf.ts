import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { invoiceRecord } from "@/lib/invoice-service";
import { paymentTotals } from "@/lib/expenses";

type DocumentInvoice = Awaited<ReturnType<typeof invoiceRecord>>;
const disclaimer = "Taslak / Ticari Belge Önizlemesi";
const money = (n: { toString(): string }) => n.toString() + " TRY";
const day = (value: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short" }).format(value);
function wrap(value: string, font: PDFFont, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").split(/\r?\n/)) {
    let line = "";
    for (const char of paragraph) { if (font.widthOfTextAtSize(line + char, size) > width && line) { result.push(line); line = ""; } line += char; }
    result.push(line);
  }
  return result;
}
export async function buildInvoicePdf(invoice: DocumentInvoice) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")), { subset: true });
  doc.setTitle(`${disclaimer} - ${invoice.number}`); doc.setCreator("WellPOS");
  let page: PDFPage, y = 0;
  function newPage() {
    page = doc.addPage([595.28, 841.89]); y = 740;
    page.drawRectangle({ x: 36, y: 763, width: 523, height: 45, color: rgb(.94,.96,.98) });
    page.drawText(disclaimer, { x: 46, y: 789, font, size: 13, color: rgb(.12,.2,.3) });
    page.drawText("Resmî e-Fatura veya e-Arşiv değildir.", { x: 46, y: 774, font, size: 9 });
  }
  function text(value: string, size = 10, indent = 0) {
    for (const line of wrap(value, font, size, 515 - indent)) {
      if (y < 58) newPage();
      // Embedded font contains Turkish glyphs; unsupported characters are rejected explicitly by fontkit.
      page.drawText(line, { x: 40 + indent, y, size, font, color: rgb(.12,.16,.22) }); y -= size + 5;
    }
  }
  newPage();
  const snapshot = invoice.snapshot as { organizationName?: string; branchName?: string; account?: { name?: string; code?: string; address?: string; phone?: string; email?: string; taxOffice?: string; taxNumber?: string } } | null;
  const account = snapshot?.account ?? invoice.currentAccount;
  text(snapshot?.organizationName ?? invoice.organization.name, 16);
  text(`Şube: ${snapshot?.branchName ?? invoice.branch.name}`);
  text(`${invoice.type === "PURCHASE" ? "Alış" : "Satış"} | ${invoice.number} | ${ { DRAFT: "Taslak", ISSUED: "Kesinleştirilmiş", CANCELLED: "İptal" }[invoice.status]}`, 12);
  text(`Tarih: ${day(invoice.invoiceDate)}    Vade: ${invoice.dueDate ? day(invoice.dueDate) : "Yok"}`);
  text(`Cari: ${account.name ?? ""} (${account.code ?? ""})`);
  if (account.address) text(`Adres: ${account.address}`);
  if (account.phone || account.email) text(`İletişim: ${account.phone ?? ""} ${account.email ?? ""}`);
  if (account.taxOffice || account.taxNumber) text(`Vergi dairesi / no: ${account.taxOffice ?? ""} / ${account.taxNumber ?? ""}`);
  text(`Fiyatlar: ${invoice.priceMode === "TAX_EXCLUSIVE" ? "KDV hariç" : "KDV dahil"} | TRY`);
  y -= 8;
  for (const [index, item] of invoice.items.entries()) {
    if (y < 155) newPage();
    text(`${index + 1}. ${item.description}`, 11);
    text(`${item.quantity} ${item.unit} x ${money(item.unitPrice)} | KDV %${item.vatRate}`, 9, 10);
    text(`Satır iskontosu: ${money(item.discountAmount)} | Genel iskonto payı: ${money(item.generalDiscountShare)}`, 9, 10);
    text(`Net: ${money(item.netAmount)} | KDV: ${money(item.taxAmount)} | Toplam: ${money(item.total)}`, 9, 10); y -= 8;
  }
  if (y < 220) newPage();
  text(`İskonto öncesi toplam: ${money(invoice.subtotal)}`);
  text(`Satır iskontoları: ${money(invoice.lineDiscountTotal)} | Genel iskonto: ${money(invoice.discountAmount)}`);
  text(`Net ara toplam: ${money(invoice.netTotal)} | KDV toplamı: ${money(invoice.taxTotal)}`);
  text(`GENEL TOPLAM: ${money(invoice.grandTotal)}`, 13);
  const totals = paymentTotals(invoice.grandTotal, invoice.allocations);
  text(`Ödenen: ${totals.paidAmount} TRY | Kalan: ${totals.remainingAmount} TRY${invoice.status === "CANCELLED" ? " (belge iptal)" : ""}`);
  if (invoice.description) text(`Açıklama: ${invoice.description}`);
  if (invoice.cancellationReason) text(`İptal gerekçesi: ${invoice.cancellationReason}`);
  doc.getPages().forEach((p, index, pages) => p.drawText(`WellPOS | Ticari önizleme | ${index + 1} / ${pages.length}`, { x: 40, y: 30, font, size: 8, color: rgb(.35,.4,.45) }));
  return doc.save();
}
