/* eslint-disable @typescript-eslint/no-require-imports -- Existing dependency-free TS test harness. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { integrationCatalog, integrationCategories, parsePrinterSettings, defaultPrinterSettings, findBarcodeProduct } = require('../src/lib/integrations.ts');
const { hasPermission } = require('../src/lib/permissions.ts');
test('catalog separates support from connection and never claims unimplemented services are available', () => {
  assert.equal(integrationCatalog.length, 8);
  assert.equal(new Set(integrationCatalog.map(x => x.category)).size, integrationCategories.length);
  for (const item of integrationCatalog) {
    assert.equal(item.connection, 'DISCONNECTED');
    assert.equal(item.support, ['printer', 'barcode'].includes(item.id) ? 'AVAILABLE' : 'COMING_SOON');
  }
});
test('settings validate widths, bounded text, unknown fields and print modes', () => {
  for (const paperWidth of ['58', '80']) assert.equal(parsePrinterSettings({ ...defaultPrinterSettings, paperWidth }).paperWidth, paperWidth);
  for (const bad of [null, [], { ...defaultPrinterSettings, paperWidth: '72' }, { ...defaultPrinterSettings, paperWidth: 80 }, { ...defaultPrinterSettings, afterSalePrint: 'SILENT' }, { ...defaultPrinterSettings, apiKey: 'secret' }, { ...defaultPrinterSettings, receiptHeader: 'x'.repeat(161) }, { ...defaultPrinterSettings, receiptFooter: 'x'.repeat(301) }]) assert.throws(() => parsePrinterSettings(bad));
});
test('only owners and administrators can change integrations; operational rights preserved', () => {
  for (const role of ['OWNER', 'ADMIN']) assert(hasPermission(role, 'integrations.manage'));
  for (const role of ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF', 'unknown']) assert.equal(hasPermission(role, 'integrations.manage'), false);
  assert(hasPermission('CASHIER', 'pos.sell')); assert(hasPermission('CASHIER', 'orders.read'));
});
test('barcode lookup is exact and preserves leading zeros', () => {
  const products = [{ id: '1', barcode: '00123' }, { id: '2', barcode: null }];
  assert.equal(findBarcodeProduct(products, ' 00123 ').id, '1');
  for (const code of ['123', '001', '', 'missing']) assert.equal(findBarcodeProduct(products, code), undefined);
});
test('actual catalog screen renders all categories and disables unimplemented integration settings', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), original = Module._load;
  require.extensions['.tsx'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
  Module._load = function(request, parent, main) { if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2)); return original.call(this, request, parent, main); };
  let Component;
  try { Component = require('../src/components/integrations/IntegrationsManager.tsx').default; } finally { Module._load = original; }
  const html = renderToStaticMarkup(React.createElement(Component, { branches: [], organizationName: 'Test', canManage: false }));
  for (const category of integrationCategories) assert(html.includes(category));
  assert.equal((html.match(/Ayarlar · Yakında/g) ?? []).length, 6);
  assert.equal((html.match(/disabled="" title="Bu entegrasyon henüz uygulanmadı/g) ?? []).length, 6);
  assert(html.includes('Yetkili olduğunuz şube bulunamadı.')); assert(!html.includes('Bağlantı: Bağlı<'));
});
test('actual POS input adds scans, increments repeat scans, rejects unknowns and ignores ordinary typing/IME', () => {
  const filename = path.resolve(__dirname, '../src/components/pos/POSManager.tsx'), original = Module._load;
  const slots = []; let cursor = 0;
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; }, useMemo(fn) { return fn(); } };
  Module._load = function(request, parent, main) {
    if (request === 'react' && parent.filename === filename) return hooks;
    if (request.includes('CustomerPicker') || request.includes('SaleReceipt')) return { __esModule: true, default: () => null };
    if (request === '@/lib/integrations') return { findBarcodeProduct };
    if (request === '@/lib/client-attempt') return require('../src/lib/client-attempt.ts');
    if (request === '@/lib/settings') return require('../src/lib/settings.ts');
    return original.call(this, request, parent, main);
  };
  let Component;
  try { const m = new Module(filename, module); m.filename = filename; m.paths = module.paths; m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename); Component = m.exports.default; } finally { Module._load = original; }
  const props = { products: [{ id: 'p', name: 'Coffee', price: '10', barcode: '00123', sku: null, category: null }], categories: [], branchId: 'A', financeAccounts: [] };
  function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
  const render = () => { cursor = 0; return Component(props); };
  const input = () => nodes(render()).find(n => n.type === 'input' && n.props['aria-label'] === 'Ürün, SKU veya barkod ara');
  function scan(code, changes = {}) { input().props.onChange({ target: { value: code } }); let prevented = false; input().props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() { prevented = true; }, ...changes }); return prevented; }
  assert.equal(scan('00123'), true); let cart = slots.find(s => Array.isArray(s) && s[0]?.productId); assert.equal(cart[0].quantity, 1);
  scan('00123'); cart = slots.find(s => Array.isArray(s) && s[0]?.productId); assert.equal(cart.length, 1); assert.equal(cart[0].quantity, 2);
  scan('bad'); assert(slots.some(s => typeof s === 'string' && s.includes('satılabilir ürün bulunamadı')));
  assert.equal(scan('00123', { key: 'a' }), false); assert.equal(scan('00123', { nativeEvent: { isComposing: true } }), false);
  assert.equal(scan('00123', { repeat: true }), false);
  assert.equal(slots.find(s => Array.isArray(s) && s[0]?.productId)[0].quantity, 2);
});
