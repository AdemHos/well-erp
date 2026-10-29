/* eslint-disable @typescript-eslint/no-require-imports -- Transactional in-memory route tests; no live DB. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { Prisma } = require('../src/generated/prisma/client.ts');
const D = value => new Prisma.Decimal(value);
let state, actor, failFinance, accounts, queue = Promise.resolve(), kitchenWhere;
function reset() {
  state = { stock: 10, status: 'OPEN', orderId: null, orders: [], movements: [], finance: [], audit: [], items: [{ id: 'item', productId: 'product', productName: 'Coffee', quantity: D(2), unitPrice: D(100), total: D(200), kitchenStatus: 'PREPARING' }] };
  actor = { userId: 'owner', organizationId: 'org', role: 'OWNER', allBranches: true, branchAccess: [] };
  accounts = [{ id: 'cash' }]; failFinance = false;
}
reset();
const inScope = where => { const w = where.AND?.[0] ?? where; return (!w.organizationId || w.organizationId === actor.organizationId) && actor.organizationId === 'org' && (!w.id || w.id === 'tab'); };
const tab = () => ({ id: 'tab', organizationId: 'org', branchId: 'branch', tableId: 'table', tabNumber: 'AD-1', status: state.status, orderId: state.orderId, items: state.items, _count: { items: state.items.length } });
const tx = {
  $queryRaw: async () => [{ id: 'tab' }],
  branch: { findFirst: async () => ({ id: 'branch' }) },
  financeAccount: { findMany: async ({ where }) => { assert.equal(where.AND[0].organizationId, 'org'); assert.equal(where.AND[0].branchId, 'branch'); return accounts; } },
  tab: { findFirst: async ({ where }) => inScope(where) ? tab() : null,
    update: async ({ data }) => { state.status = data.status; state.orderId = data.orderId ?? state.orderId; return tab(); },
    findMany: async ({ where }) => { kitchenWhere = where; return []; } },
  branchStock: { updateMany: async ({ data }) => { if (state.stock < Number(data.quantity.decrement)) return { count: 0 }; state.stock -= Number(data.quantity.decrement); return { count: 1 }; } },
  order: { create: async ({ data }) => { const order = { ...data, id: 'order', createdAt: new Date('2026-10-27T10:00:00Z') }; state.orders.push(order); return order; },
    findFirst: async () => state.orders.length ? { ...state.orders[0], financeTransactions: state.finance } : null },
  stockMovement: { create: async ({ data }) => { state.movements.push(data); return data; } },
  financeTransaction: { create: async ({ data }) => { if (failFinance) throw new Error('Injected finance failure'); state.finance.push(data); return data; } },
  auditLog: { create: async ({ data }) => { state.audit.push(data); return data; } },
};
const db = { ...tx, $transaction: work => {
  const run = queue.then(async () => { const before = { ...state, orders: [...state.orders], finance: [...state.finance], movements: [...state.movements], audit: [...state.audit] }; try { return await work(tx); } catch (error) { state = before; throw error; } }); queue = run.catch(() => {}); return run;
} };
const load = Module._load;
Module._load = function (request, parent, main) {
  if (request === '@/lib/prisma') return { prisma: db };
  if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return load.call(this, request, parent, main);
};
const { POST: checkout } = require('../src/app/api/restaurant/tabs/[id]/checkout/route.ts');
const { PATCH: cancel } = require('../src/app/api/restaurant/tabs/[id]/route.ts');
function tabMatches(where) {
  if (where.organizationId && where.organizationId !== 'org') return false;
  if (where.status && where.status !== state.status) return false;
  if (where.order && where.order.status !== state.orders[0]?.status) return false;
  return !where.OR || where.OR.some(tabMatches);
}
tx.tabItem = db.tabItem = {
  findFirst: async ({where}) => where.id === 'item' && actor.organizationId === 'org' && tabMatches(where.tab ?? {}) ? state.items[0] ?? null : null,
  updateMany: async ({where,data}) => {
    const item=state.items[0];if(!item || item.kitchenStatus!==where.kitchenStatus || !tabMatches(where.tab))return {count:0};
    Object.assign(item,data);return {count:1};
  },
  findUnique: async () => state.items[0],
};
const { PATCH: updateKitchen } = require('../src/app/api/restaurant/kitchen/items/[itemId]/route.ts');
const { GET: kitchen } = require('../src/app/api/restaurant/kitchen/route.ts');
const { NextRequest } = require('next/server');
Module._load = load;
const context = () => ({ params: Promise.resolve({ id: 'tab' }) });
const pay = (data = {}) => checkout(new NextRequest('http://localhost/api/restaurant/tabs/tab/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentMethod: 'CASH', ...data }) }), context());
test('restaurant payment records one exact finance entry and stock change; concurrent retry replays', async () => {
  reset(); const results = await Promise.all([pay(), pay()]); assert(results.every(r => r.status === 200));
  assert.equal(state.stock, 8); assert.equal(state.orders.length, 1); assert.equal(state.finance.length, 1); assert.equal(state.status, 'CLOSED');
  assert.equal(state.finance[0].source, 'POS_SALE'); assert.equal(state.finance[0].accountId, 'cash'); assert(state.finance[0].amount.eq(200));
  assert.equal((await pay({ paymentMethod: 'CARD' })).status, 409);
});
test('missing/ambiguous accounts and finance failure cannot close a table or consume inventory', async () => {
  for (const candidates of [[], [{ id: 'one' }, { id: 'two' }]]) { reset(); accounts = candidates; assert.equal((await pay()).status, 409); assert.equal(state.stock, 10); assert.equal(state.orders.length, 0); }
  reset(); failFinance = true; const log = console.error; console.error = () => {};
  try { assert.equal((await pay()).status, 500); } finally { console.error = log; }
  assert.equal(state.stock, 10); assert.equal(state.status, 'OPEN'); assert.equal(state.orders.length, 0); assert.equal(state.movements.length, 0);
});
test('waiter cannot take payment, foreign organization cannot reach the tab', async () => {
  reset(); actor.role = 'WAITER'; assert.equal((await pay()).status, 403);
  actor.role = 'OWNER'; actor.organizationId = 'foreign'; assert.equal((await pay()).status, 404); assert.equal(state.finance.length, 0);
});
test('only empty unpaid tabs can be cancelled and their cancellation is audited', async () => {
  reset(); const request = () => new NextRequest('http://localhost/api/restaurant/tabs/tab', { method: 'PATCH', body: JSON.stringify({ action: 'CANCEL_EMPTY' }) });
  assert.equal((await cancel(request(), context())).status, 409); state.items = [];
  assert.equal((await cancel(request(), context())).status, 200); assert.equal(state.status, 'CANCELLED'); assert.equal(state.audit[0].action, 'restaurant.tab.cancel');
  assert.equal((await cancel(request(), context())).status, 200); assert.equal(state.audit.length, 1);
});
test('kitchen includes paid closed orders with unfinished items and excludes refunded/cancelled work', async () => {
  reset(); const result = await kitchen(new NextRequest('http://localhost/api/restaurant/kitchen?branchId=branch'));
  assert.equal(result.status, 200);
  const where = kitchenWhere.AND[0]; assert.deepEqual(where.OR, [{ status: 'OPEN' }, { status: 'CLOSED', order: { status: 'COMPLETED' } }]);
  assert.deepEqual(where.items.some.OR[0], { kitchenStatus: { not: 'SERVED' } });
  assert.equal(where.items.some.OR[1].kitchenStatus, 'SERVED');
  assert(Math.abs(where.items.some.OR[1].kitchenServedAt.gte.getTime() - (Date.now() - 86400000)) < 5000);
});

test('paid kitchen items can advance to ready and served, but refunded orders cannot advance',async()=>{
  reset();assert.equal((await pay()).status,200);
  const change=status=>updateKitchen(new NextRequest('http://localhost/api/restaurant/kitchen/items/item',{method:'PATCH',body:JSON.stringify({status})}),{params:Promise.resolve({itemId:'item'})});
  assert.equal((await change('SERVED')).status,409);
  assert.equal((await change('READY')).status,200);assert.equal(state.items[0].kitchenStatus,'READY');
  state.orders[0].status='REFUNDED';assert.equal((await change('SERVED')).status,404);assert.equal(state.items[0].kitchenStatus,'READY');
  state.orders[0].status='COMPLETED';assert.equal((await change('SERVED')).status,200);assert.equal(state.items[0].kitchenStatus,'SERVED');
});
