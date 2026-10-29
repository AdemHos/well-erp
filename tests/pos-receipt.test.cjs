/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads TSX through a scoped transpilation hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Exercise the actual TSX component without adding a test runtime dependency.
require.extensions[".tsx"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

const { default: SaleReceipt, ReceiptContent } = require("../src/components/pos/SaleReceipt.tsx");
const order = {
  id: "saved-order",
  orderNumber: "POS-SAVED-123",
  createdAt: "2026-10-19T22:30:00.000Z",
  organization: { name: "Örnek İşletme" },
  branch: { name: "Kadıköy Şubesi" },
  paymentMethod: "CASH",
  subtotal: "60.00",
  discountType: "PERCENT",
  discountValue: "10",
  discountAmount: "6.00",
  total: "54.00",
  items: [{ id: "item-1", productName: "Kayıtlı ürün", quantity: "2.5", unitPrice: "24.00", total: "60.00" }],
};
const render = (changes = {}) => renderToStaticMarkup(React.createElement(ReceiptContent, { order: { ...order, ...changes } }));
const money = (value) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);

test("receipt uses saved business, branch, item details and Istanbul sale date", () => {
  const html = render();
  for (const text of [order.organization.name, order.branch.name, order.orderNumber,
    "20.10.2026", "01:30:00", "Kayıtlı ürün", "2,5", money(24), money(60), money(54), "Nakit"]) {
    assert.ok(html.includes(text), `Missing ${text}`);
  }
  assert.ok(!html.includes("WellPOS"));
  assert.ok(!html.includes("KDV"));
});

test("receipt prints server totals directly without recalculating from cart or line prices", () => {
  const html = render({ total: "53.99", subtotal: "59.99" });
  assert.ok(html.includes(money(53.99)));
  assert.ok(html.includes(money(59.99)));
});

test("percentage, fixed, full and absent discounts render correctly", () => {
  assert.ok(render().includes("İndirim (%10)"));
  const fixed = render({ discountType: "FIXED", discountValue: "6" });
  assert.ok(fixed.includes(`İndirim (${money(6)})`));
  assert.ok(fixed.includes(`−${money(6)}`));
  assert.ok(render({ discountType: "PERCENT", discountValue: "100", discountAmount: "60", total: "0" }).includes(money(0)));
  assert.ok(!render({ discountType: null, discountValue: "0", discountAmount: "0" }).includes("İndirim"));
});

test("user supplied names are escaped, including long names", () => {
  const name = '<script>alert("x")</script> & ' + "Çok uzun ürün ".repeat(50);
  const html = render({ organization: { name }, branch: { name }, items: [{ ...order.items[0], productName: name }] });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("card payment and informational receipt notice are explicit", () => {
  const html = render({ paymentMethod: "CARD" });
  for (const text of ["Kart", "Teşekkür ederiz", "Bilgilendirme amaçlı", "Mali fiş veya e-Arşiv fatura değildir."]) {
    assert.ok(html.includes(text));
  }
});

test("receipt uses saved business identity after an organization rename", () => {
  const html = render({ businessSnapshot: { name: "Satış anındaki işletme" }, organization: { name: "Yeni işletme adı" } });
  assert(html.includes("Satış anındaki işletme"));
  assert(!html.includes("Yeni işletme adı"));
});

test("reprinted historical receipt identifies a refunded sale", () => {
  const html = render({ status: "REFUNDED" });
  assert.ok(html.includes("İADE EDİLMİŞ SATIŞ"));
  assert.ok(html.includes("ORİJİNAL FİŞ"));
  assert.ok(html.includes(order.orderNumber));
});

test("printer offers both paper widths and an isolated print document", () => {
  const html = renderToStaticMarkup(React.createElement(SaleReceipt, { order }));
  assert.ok(html.includes('value="58"'));
  assert.ok(html.includes('value="80"'));
  assert.ok(html.includes("Fiş Yazdır"));
  assert.ok(html.includes("srcDoc="));
  assert.ok(html.includes("@page { size: auto; margin: 0; }"));
  assert.ok(html.includes("width: 80mm"));
  assert.ok(!html.includes("Örnek İşletme"), "Sale data must not be interpolated into srcDoc HTML");
});

test("branch receipt settings render safe custom text and both actual paper layouts", () => {
  const settings = { paperWidth: "58", receiptHeader: '<script>bad</script> Başlık', receiptFooter: 'Şube alt mesajı', afterSalePrint: 'MANUAL' };
  const html = renderToStaticMarkup(React.createElement(ReceiptContent, { order, settings }));
  assert(html.includes('&lt;script&gt;bad&lt;/script&gt; Başlık'));
  assert(html.includes('Şube alt mesajı'));
  assert(!html.includes('<script>'));
  assert(html.includes('Mali fiş veya e-Arşiv fatura değildir.'));
  for (const paperWidth of ['58', '80']) {
    const printer = renderToStaticMarkup(React.createElement(SaleReceipt, { order, settingsOverride: { ...settings, paperWidth } }));
    assert(printer.includes(`width: ${paperWidth}mm`));
    assert(printer.includes(paperWidth === '58' ? '11px/1.4' : '12px/1.4'));
    assert(!printer.includes('Şube alt mesajı'), 'User text must stay outside srcDoc');
  }
});
