import { reportCellLabel } from "@/lib/report-config";
import { NextRequest, NextResponse } from "next/server";
import { CashError } from "@/lib/cash-management";
import { csvCell } from "@/lib/current-accounts";
import { loadReport, reportError } from "@/lib/report-service";
import type { Column, ReportResult } from "@/lib/reports";

type Cell = { value: string | null; kind?: Column["kind"] };
const dateText = (value: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
function exportRows(report: ReportResult): Cell[][] {
  const row = (...values: (string | null)[]) => values.map(value => ({ value }));
  const rows: Cell[][] = [row("WellPOS", report.title), row("Tarih aralığı", report.range.startDay, report.range.endDay), row("Saat dilimi", report.range.timezone), row("Şube kapsamı", report.branchLabel), row("Rapor zamanı", dateText(report.generatedAt)), row("Gösterge", "Değer", "Açıklama")];
  for (const m of report.metrics) rows.push([{ value: m.title }, { value: m.value, kind: m.kind }, { value: m.note ?? "" }]);
  for (const warning of report.warnings) rows.push(row("Hesaplama / kapsam", warning));
  for (const table of report.tables) {
    rows.push([], row(table.title), row("Kapsam", table.note ?? "Seçilen tarih aralığı ve yetkili şube kapsamı"), table.columns.map(c => ({ value: c.title })));
    for (const r of table.rows) rows.push(table.columns.map(c => ({ value: reportCellLabel(r[c.key], c.key, table.key), kind: c.kind })));
  }
  return rows;
}
export function reportCsv(report: ReportResult) {
  return "\uFEFF" + exportRows(report).map(row => row.map(c => {
    let value = c.value ?? (c.kind === "money" || c.kind === "percent" ? "Hesaplanamadı" : "—");
    if (c.value && c.kind === "date") value = dateText(c.value);
    if (c.value && ["money", "number", "percent"].includes(c.kind ?? "")) value = c.value.replace(".", ",");
    return csvCell(value);
  }).join(";")).join("\r\n");
}
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const crcTable = Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes: Buffer) { let n = 0xffffffff; for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
// Small bounded OOXML ZIP writer. Stored entries need no runtime dependency,
// external process, macros, formulas, external relationships or temporary files.
function zip(files: Record<string, string>) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path), data = Buffer.from(content), crc = crc32(data);
    if (offset + data.length > 32 * 1024 * 1024) throw new CashError("Excel çıktısı çok büyük. Filtreleri daraltın.", 422);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42); central.push(c, name); offset += h.length + name.length + data.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
function columnName(i: number) { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
export function reportXlsx(report: ReportResult) {
  const rows = exportRows(report).map((row, r) => `<row r="${r + 1}">${row.map((c, i) => {
    const ref = columnName(i) + (r + 1), value = c.value;
    if (value != null && c.kind && ["money", "number", "percent"].includes(c.kind) && /^-?\d+(?:\.\d+)?$/.test(value) && value.replace(/[^0-9]/g, "").length <= 15) return `<c r="${ref}" s="${c.kind === "money" ? 1 : 0}"><v>${value}</v></c>`;
    if (value && c.kind === "date") {
      // Excel has no timezone; store the visible Istanbul wall-clock as a serial.
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
      const n = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 86400000 + 25569;
      if (Number.isFinite(n)) return `<c r="${ref}" s="2"><v>${n}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? (c.kind === "money" || c.kind === "percent" ? "Hesaplanamadı" : "—"))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="WellPOS Rapor" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00&quot; TRY&quot;"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="12" width="28" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`,
  });
}
export async function exportReport(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format");
    if (format !== "csv" && format !== "xlsx") throw new CashError("CSV veya XLSX biçimi seçin.");
    const result = await loadReport(request, true);
    return new NextResponse(format === "csv" ? reportCsv(result) : new Uint8Array(reportXlsx(result)), { headers: { "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="wellpos-${result.key}-${result.range.startDay}-${result.range.endDay}.${format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return reportError(error); }
}
