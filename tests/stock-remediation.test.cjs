/* eslint-disable @typescript-eslint/no-require-imports -- Offline route harness, no PostgreSQL connection. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { Prisma } = require('../src/generated/prisma/client.ts');
let stock, level, movements, audit, actor, failMovement, queue = Promise.resolve();
function reset() { stock = 10; level = 2; movements = []; audit = []; failMovement = false; actor = { organizationId: 'org', userId: 'owner', role: 'OWNER', allBranches: true, branchAccess: [] }; }
reset();
const scoped = where => { const w = where.AND?.[0] ?? where; return w.organizationId === 'org' && w.branchId === 'branch' && w.productId === 'product'; };
const savedStock = () => ({ id: 'stock', organizationId: 'org', branchId: 'branch', productId: 'product', quantity: new Prisma.Decimal(stock), criticalLevel: new Prisma.Decimal(level), product: { id: 'product', name: 'Coffee' }, branch: { id: 'branch', name: 'Main' } });
const db = {
  $queryRaw: async () => [],
  branch: { findFirst: async ({ where }) => { const w = where.AND?.[0] ?? where; return w.organizationId === 'org' && w.id === 'branch' ? { id: 'branch' } : null; } },
  product: { findFirst: async ({ where }) => where.organizationId === 'org' && where.id === 'product' ? { id: 'product' } : null },
  branchStock: {
    upsert: async ({ update }) => { stock += Number(update.quantity.increment); if (update.criticalLevel !== undefined) level = Number(update.criticalLevel); return savedStock(); },
    findFirst: async ({ where }) => scoped(where) ? savedStock() : null,
    findUniqueOrThrow: async () => savedStock(),
    updateMany: async ({ where, data }) => { if (!scoped(where)) return { count: 0 }; if (data.criticalLevel !== undefined) level = Number(data.criticalLevel); if (data.quantity) { const w = where.AND?.[0] ?? where; if (w.quantity?.gte && stock < Number(w.quantity.gte)) return { count: 0 }; stock -= Number(data.quantity.decrement); } return { count: 1 }; },
  },
  stockMovement: { create: async ({ data }) => { if (failMovement) throw Error('Injected movement failure'); const value = { ...data, id: 'movement-' + movements.length }; movements.push(value); return value; }, findFirst: async ({ where }) => movements.find(row => row.id === where.id && row.organizationId === where.organizationId) ?? null },
  auditLog: { findUnique: async ({ where }) => audit.find(row => row.id === where.id) ?? null, create: async ({ data }) => { audit.push(data); return data; } },
};
db.$transaction = work => { const run = queue.then(async () => { const before = { stock, level, movements: [...movements], audit: [...audit] }; try { return await work(db); } catch (error) { ({ stock, level, movements, audit } = before); throw error; } }); queue = run.catch(() => {}); return run; };
const load = Module._load;
Module._load = function (request, parent, main) {
  if (request === '@/lib/prisma') return { prisma: db };
  if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
  if (request === '@/lib/order-access') return { getOrderBranchId: async () => 'branch' };
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return load.call(this, request, parent, main);
};
const { POST: receive, PATCH: changeLevel } = require('../src/app/api/stock/route.ts');
const { POST: adjust } = require('../src/app/api/stock/movements/route.ts');
Module._load = load;
const request = (body, method = 'POST') => new Request('http://localhost/api/stock', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'product', branchId: 'branch', ...body }) });
test('stock receipt retries create exactly one movement and apply an edited critical threshold', async () => {
  reset(); const body = { quantity: '3.125', criticalLevel: '5.5', idempotencyKey: crypto.randomUUID() };
  const responses = await Promise.all([receive(request(body)), receive(request(body))]); assert(responses.every(r => r.status === 201));
  assert.equal(stock, 13.125); assert.equal(level, 5.5); assert.equal(movements.length, 1);
  assert.equal((await receive(request({ ...body, quantity: '4' }))).status, 409); assert.equal(stock, 13.125);
});
test('critical threshold can change without inventing a stock receipt, including zero', async () => {
  reset(); assert.equal((await changeLevel(request({ criticalLevel: '0' }, 'PATCH'))).status, 200);
  assert.equal(stock, 10); assert.equal(level, 0); assert.equal(movements.length, 0); assert.equal(audit[0].action, 'stock.critical-level.update');
  assert.equal((await changeLevel(request({ criticalLevel: '-1' }, 'PATCH'))).status, 400);
});
test('manual stock exits are replay-safe and insufficient quantities roll back', async () => {
  reset(); const body = { quantity: '4', type: 'WASTE', idempotencyKey: crypto.randomUUID() };
  assert.equal((await adjust(request(body))).status, 201); assert.equal((await adjust(request(body))).status, 201); assert.equal(stock, 6); assert.equal(movements.length, 1);
  assert.equal((await adjust(request({ ...body, quantity: '7', idempotencyKey: crypto.randomUUID() }))).status, 400); assert.equal(stock, 6);
});
test('movement failure rolls inventory and replay marker back; foreign tenant cannot alter the threshold', async () => {
  reset(); failMovement = true; const log = console.error; console.error = () => {};
  try { assert.equal((await receive(request({ quantity: '3', idempotencyKey: crypto.randomUUID() }))).status, 500); } finally { console.error = log; }
  assert.equal(stock, 10); assert.equal(audit.length, 0);
  actor.organizationId = 'other'; assert.equal((await changeLevel(request({ criticalLevel: '9' }, 'PATCH'))).status, 404); assert.equal(level, 2);
});
