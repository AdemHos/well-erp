/* eslint-disable @typescript-eslint/no-require-imports -- Actual independent transactions on disposable localhost PostgreSQL. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('MVP: concurrent sale/replay/refund, stock and tenant constraints, real dashboard', { skip: process.env.WELLPOS_MVP_DB_TEST !== '1', timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1', 'Acceptance tests may only use disposable localhost PostgreSQL');
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  const { PrismaClient } = require('../src/generated/prisma/client.ts');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
  const original = Module._load;
  try {
    const org = await db.organization.create({ data: { name: 'Synthetic acceptance', slug: crypto.randomUUID() } });
    const user = await db.user.create({ data: { email: crypto.randomUUID() + '@mvp.invalid' } });
    await db.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } });
    const branch = await db.branch.create({ data: { organizationId: org.id, name: 'Acceptance' } });
    const actor = { userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] };
    await db.financeAccount.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Synthetic cash', type: 'CASH', openingBalance: 1000 } });
    Module._load = function(request, parent, main) {
      if (request === '@/lib/prisma') return { prisma: db };
      if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
      if (request === 'next/headers') return { cookies: async () => ({ get: () => ({ value: branch.id }) }) };
      if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
      return original.call(this, request, parent, main);
    };
    const orders = require('../src/app/api/orders/route.ts');
    const refunds = require('../src/app/api/orders/[id]/refund/route.ts');
    const { loadDashboard } = require('../src/lib/dashboard-data.ts');
    const checkout = require('../src/app/api/restaurant/tabs/[id]/checkout/route.ts');
    Module._load = original;
    const product = async quantity => {
      const p = await db.product.create({ data: { organizationId: org.id, name: 'Synthetic item', price: 25, isSellable: true } });
      await db.branchStock.create({ data: { organizationId: org.id, branchId: branch.id, productId: p.id, quantity } });
      return p;
    };
    const sale = async (p, key = crypto.randomUUID(), extra = {}) => {
      const r = await orders.POST(new Request('http://localhost/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branchId: branch.id, paymentMethod: 'CASH', idempotencyKey: key, items: [{ productId: p.id, quantity: 1 }], ...extra }) }));
      return { status: r.status, body: await r.json() };
    };
    const stock = async p => (await db.branchStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: branch.id, productId: p.id } } })).quantity.toString();
    const p = await product(5), key = crypto.randomUUID();
    const replay = await Promise.all([sale(p, key), sale(p, key)]);
    assert.deepEqual(replay.map(r => r.status).sort(), [200, 201], JSON.stringify(replay));
    assert.equal(replay[0].body.order.id, replay[1].body.order.id);
    assert.equal(await stock(p), '4');
    assert.equal(await db.financeTransaction.count({ where: { orderId: replay[0].body.order.id, source: 'POS_SALE' } }), 1);
    assert.equal((await sale(p, key, { note: 'changed payload' })).status, 409);
    const last = await product(1);
    const contested = await Promise.all([sale(last), sale(last)]);
    assert.deepEqual(contested.map(r => r.status).sort(), [201, 409], JSON.stringify(contested));
    assert.equal(await stock(last), '0');
    const id = replay[0].body.order.id;
    const refund = () => refunds.POST(new Request('http://localhost/api/orders/' + id + '/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Synthetic acceptance' }) }), { params: Promise.resolve({ id }) });
    assert.deepEqual((await Promise.all([refund(), refund()])).map(r => r.status).sort(), [200, 409]);
    assert.equal(await stock(p), '5');
    assert.equal(await db.financeTransaction.count({ where: { orderId: id, source: 'POS_REFUND' } }), 1);
    const other = await db.organization.create({ data: { name: 'Foreign synthetic', slug: crypto.randomUUID() } });
    const foreign = await db.product.create({ data: { organizationId: other.id, name: 'Foreign', price: 5, isSellable: true } });
    assert.equal((await sale(foreign)).status, 400);
    await assert.rejects(db.branchStock.create({ data: { organizationId: org.id, branchId: branch.id, productId: foreign.id, quantity: 1 } }), e => e.code === 'P2003');
    const data = await loadDashboard(actor);
    assert.equal(data.total, '25.00');
    assert.equal(data.count, 1);
    assert.equal(data.orders.length, 2);
    const table = await db.restaurantTable.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Concurrent table' } });
    const tab = await db.tab.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table.id, tabNumber: crypto.randomUUID(), items: { create: { productId: p.id, productName: p.name, quantity: 1, unitPrice: 25, total: 25 } } } });
    await assert.rejects(db.tab.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table.id, tabNumber: crypto.randomUUID() } }), e => e.code === 'P2002');
    const close = () => checkout.POST(new Request('http://localhost/api/restaurant/tabs/' + tab.id + '/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentMethod: 'CASH' }) }), { params: Promise.resolve({ id: tab.id }) });
    const closed = await Promise.all([close(), close()]);
    assert.deepEqual(closed.map(r => r.status), [200, 200]);
    const paid = await db.tab.findUniqueOrThrow({ where: { id: tab.id } });
    assert.equal(paid.status, 'CLOSED');
    assert.equal(await db.financeTransaction.count({ where: { orderId: paid.orderId, source: 'POS_SALE' } }), 1);
    assert.equal(await stock(p), '4');
  } finally { Module._load = original; await db.$disconnect(); }
});
