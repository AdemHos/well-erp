/* eslint-disable @typescript-eslint/no-require-imports -- Offline Decimal validation. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const load = Module._load; Module._load = function(request, parent, main) { if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2)); return load.call(this, request, parent, main); };
const { invoiceInput } = require('../src/lib/invoices.ts'); Module._load = load;
const item = changes => ({ description: 'Türkçe hizmet', unit: 'Adet', quantity: '1', unitPrice: '100', vatRate: '20', ...changes });
const input = changes => ({ type: 'PURCHASE', number: '  ref-1 ', invoiceDate: '2026-10-01', branchId: 'a', currentAccountId: 'supplier', priceMode: 'TAX_EXCLUSIVE', items: [item()], ...changes });
test('multiple VAT rates, line discount and general allocation calculate exact server totals', () => {
  const invoice = invoiceInput(input({ discountType: 'PERCENT', discountValue: '10', items: [item({ quantity: '2', discountType: 'PERCENT', discountValue: '10' }), item({ unitPrice: '50', vatRate: '10' })] }));
  assert.equal(invoice.subtotal.toString(), '250'); assert.equal(invoice.lineDiscountTotal.toString(), '20'); assert.equal(invoice.discountAmount.toString(), '23'); assert.equal(invoice.netTotal.toString(), '207'); assert.equal(invoice.taxTotal.toString(), '36.9'); assert.equal(invoice.grandTotal.toString(), '243.9');
});
test('inclusive and exclusive produce same total; explicit zero VAT and free lines allowed in draft', () => {
  const exclusive = invoiceInput(input()), inclusive = invoiceInput(input({priceMode:'TAX_INCLUSIVE',items:[item({unitPrice:'120'})]}));
  assert(exclusive.grandTotal.eq(inclusive.grandTotal)); assert(exclusive.netTotal.eq(inclusive.netTotal)); assert.equal(invoiceInput(input({items:[item({unitPrice:'0',vatRate:'0'})]})).grandTotal.toString(),'0');
});
test('largest remainder allocation preserves every penny and stable line order', () => {
  const invoice = invoiceInput(input({ discountType:'FIXED',discountValue:'0.01',items:[item({unitPrice:'0.01',vatRate:'0'}),item({unitPrice:'0.01',vatRate:'0'}),item({unitPrice:'0.01',vatRate:'0'})] }));
  assert.deepEqual(invoice.items.map(x=>x.generalDiscountShare.toString()),['0.01','0','0']);assert.equal(invoice.grandTotal.toString(),'0.02');
});
test('reject missing/invalid VAT and price mode, quantities, precision, overdiscount and overflow', () => {
  for(const changes of [{priceMode:''},{items:[item({vatRate:undefined})]},{items:[item({vatRate:'101'})]},{items:[item({quantity:'-1'})]},{items:[item({quantity:'0'})]},{items:[item({quantity:'1.0001'})]},{items:[item({unitPrice:'1.00001'})]},{items:[item({unitPrice:'NaN'})]},{items:[item({unitPrice:'-1'})]},{discountType:'PERCENT',discountValue:'101'},{discountType:'FIXED',discountValue:'101'},{items:[item({quantity:'99999999999',unitPrice:'99999999999'})]},{items:[]},{dueDate:'2026-01-01'}]) assert.throws(()=>invoiceInput(input(changes)));
});
test('number normalization and expense restrictions are consistent', () => {assert.equal(invoiceInput(input()).numberKey,'REF-1');assert.throws(()=>invoiceInput(input({type:'SALES',expenseId:'e'})));assert.throws(()=>invoiceInput(input({expenseId:'e',expenseCategoryId:'c'})));assert.throws(()=>invoiceInput(input({number:'A\nB'})));});
