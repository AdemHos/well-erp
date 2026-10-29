/* eslint-disable @typescript-eslint/no-require-imports -- Offline API harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { Prisma } = require('../src/generated/prisma/client.ts');
const D = value => new Prisma.Decimal(value);
let entries, accounts, actor, failAt, audit, queue;
function reset() {
  entries = []; audit = []; failAt = 0; queue = Promise.resolve();
  actor = { role: 'OWNER', organizationId: 'org', userId: 'owner', allBranches: true, branchAccess: [] };
  accounts = [
    { id: 'cash', organizationId: 'org', branchId: 'a', name: 'Cash', type: 'CASH', openingBalance: D('100.10'), isActive: true },
    { id: 'bank', organizationId: 'org', branchId: 'b', name: 'Bank', type: 'BANK', openingBalance: D('25.20'), isActive: true },
  ];
}
function matches(item, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(clause => matches(item, clause));
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(item[key]);
    if (value && typeof value === 'object' && ('gte' in value || 'lte' in value)) return (!value.gte || item[key] >= value.gte) && (!value.lte || item[key] <= value.lte);
    return item[key] === value;
  });
}
const tx = {
  $queryRaw: async () => [],
  financeAccount: {
    findMany: async ({ where }) => accounts.filter(a => matches(a, where)),
    findFirst: async ({ where }) => accounts.find(a => matches(a, where)) || null,
    update: async ({ where, data }) => { const account = accounts.find(a => a.id === where.id); Object.assign(account, data); return account; },
  },
  financeTransaction: {
    findMany: async ({ where }) => entries.filter(e => matches(e, where)),
    findFirstOrThrow: async ({where}) => { const row=entries.find(e=>matches(e,where));if(!row)throw Error("Not found");return row; },
    count: async ({ where }) => entries.filter(e => matches(e, where)).length,
    groupBy: async ({ where }) => ['IN', 'OUT'].map(direction => ({ direction, _sum: { amount: entries.filter(e => matches(e, where) && e.direction === direction).reduce((sum, e) => sum.plus(e.amount), D(0)) } })),
    create: async ({ data }) => {
      if (failAt && entries.length + 1 === failAt) throw Error('Injected second-leg failure');
      if (entries.some(e => e.id === data.id)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });
      const entry = { ...data, id: data.id || `manual_${entries.length}` }; entries.push(entry); return entry;
    },
  },
  auditLog: { findUnique: async ({where}) => audit.find(row => row.id === where.id) ?? null, create: async ({ data }) => { audit.push(data); return data; } },
};
const prisma = { ...tx, branch: { findFirst: async () => ({ id: 'a' }) }, $transaction: (work, options) => {
  assert.equal(options.isolationLevel, 'Serializable');
  const run = queue.then(async () => {
    const before = [...entries], logs = [...audit], saved = accounts.map(a => ({ ...a }));
    try { return await work(tx); } catch (error) { entries = before; audit = logs; accounts = saved; throw error; }
  }); queue = run.catch(() => {}); return run;
} };
reset();
const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === '@/lib/prisma') return { prisma };
  if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return load.call(this, request, parent, main);
};
const { POST } = require('../src/app/api/finance/transfers/route.ts');
const { PATCH } = require('../src/app/api/finance/accounts/[id]/route.ts');
const { assertCashAvailable, cashAmount, transferIds, serialCashTransaction } = require('../src/lib/cash-management.ts');
const financeAPI = require('../src/app/api/finance/transactions/route.ts');
const { NextRequest } = require('next/server');
Module._load = load;
const payload = { fromAccountId: 'cash', toAccountId: 'bank', amount: '40.05', idempotencyKey: 'request_1234567890' };
const transfer = (data = {}, headers = {}) => POST(new Request('http://localhost/api/finance/transfers', { method: 'POST', headers, body: JSON.stringify({ ...payload, ...data }) }));
const patch = data => PATCH(new Request('http://localhost/api/finance/accounts/cash', { method: 'PATCH', body: JSON.stringify(data) }), { params: Promise.resolve({ id: 'cash' }) });
const balance = id => entries.filter(e => e.accountId === id).reduce((sum, e) => e.direction === 'IN' ? sum.plus(e.amount) : sum.minus(e.amount), accounts.find(a => a.id === id).openingBalance);

test('transfer preserves total business balance with exact decimal arithmetic and records both branches', async () => {
  reset(); const total = balance('cash').plus(balance('bank'));
  assert.equal((await transfer()).status, 201);
  assert.equal(balance('cash').toFixed(2), '60.05'); assert.equal(balance('bank').toFixed(2), '65.25');
  assert(balance('cash').plus(balance('bank')).eq(total));
  assert.deepEqual(entries.map(e => [e.direction, e.branchId]), [['OUT', 'a'], ['IN', 'b']]);
  assert.equal(entries[0].reference, entries[1].reference); assert.equal(audit.length, 1);
});
test('concurrent repeated request produces one transfer; a changed payload conflicts', async () => {
  reset(); assert.deepEqual((await Promise.all([transfer(), transfer(), transfer()])).map(r => r.status).sort(), [200, 200, 201]);
  assert.equal(entries.length, 2); assert.equal(audit.length, 1);
  for (const data of [{ amount: '41' }, { description: 'changed' }, { fromAccountId: 'bank', toAccountId: 'cash' }]) assert.equal((await transfer(data)).status, 409);
  accounts[0].isActive = false; assert.equal((await transfer()).status, 200);
});
test('reject invalid amounts, same account, inactive accounts and insufficient balance without writes', async () => {
  for (const amount of ['-1', '0', '1.001', 'NaN', 'Infinity', '', '1000000000000', {}, null]) {
    reset(); assert.equal((await transfer({ amount })).status, 400); assert.equal(entries.length, 0);
  }
  reset(); assert.equal((await transfer({ toAccountId: 'cash' })).status, 400);
  assert.equal((await transfer({ amount: '100.11' })).status, 409);
  accounts[1].isActive = false; assert.equal((await transfer()).status, 409); assert.equal(entries.length, 0);
});
test('authentication, permissions, tenant, both branch scopes and origin are enforced', async () => {
  reset(); actor = null; assert.equal((await transfer()).status, 401);
  reset(); actor.role = 'CASHIER'; assert.equal((await transfer()).status, 403);
  reset(); actor.organizationId = 'foreign'; assert.equal((await transfer()).status, 404);
  for (const branchId of ['a', 'b']) {
    reset(); actor.role = 'MANAGER'; actor.allBranches = false; actor.branchAccess = [{ branchId }];
    assert.equal((await transfer()).status, 404); assert.equal(entries.length, 0);
  }
  reset(); assert.equal((await transfer({}, { origin: 'http://foreign' })).status, 403); assert.equal(entries.length, 0);
});
test('second-leg failure rolls back outgoing movement and audit; retry succeeds', async () => {
  reset(); failAt = 2; const log = console.error; console.error = () => {};
  try { assert.equal((await transfer()).status, 500); } finally { console.error = log; }
  assert.equal(entries.length, 0); assert.equal(audit.length, 0);
  failAt = 0; assert.equal((await transfer()).status, 201); assert.equal(entries.length, 2);
});
test('concurrent different transfers cannot overdraw the source', async () => {
  reset(); const results = await Promise.all([transfer({ amount: '70' }), transfer({ amount: '70', idempotencyKey: 'different_1234567890' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert(balance('cash').gte(0));
});
test('POS sale and refund entries contribute to available cash', async () => {
  reset(); entries.push({ accountId: 'cash', organizationId: 'org', direction: 'IN', source: 'POS_SALE', amount: D(20) }, { accountId: 'cash', organizationId: 'org', direction: 'OUT', source: 'POS_REFUND', amount: D(15) });
  await assertCashAvailable(tx, accounts[0], D('105.10'));
  await assert.rejects(assertCashAvailable(tx, accounts[0], D('105.11')), /yetersiz/);
});
test('account edits and deactivation preserve movement history, prohibit financial rewrites and tenant/branch escape', async () => {
  reset(); assert.equal((await patch({ name: 'New cash', openingBalance: '110.10' })).status, 200);
  assert.equal((await transfer()).status, 201);
  assert.equal((await patch({ type: 'BANK' })).status, 409);
  assert.equal((await patch({ openingBalance: '1' })).status, 409);
  assert.equal((await patch({ branchId: 'other' })).status, 400);
  assert.equal((await patch({ isActive: false })).status, 200); assert.equal(entries.length, 2);
  actor.organizationId = 'foreign'; assert.equal((await patch({ name: 'foreign' })).status, 404);
  reset(); actor.role = 'MANAGER'; actor.allBranches = false; actor.branchAccess = [{ branchId: 'b' }]; assert.equal((await patch({ name: 'wrong branch' })).status, 404);
});
test('transfer keys are tenant-scoped and decimal validation is strict', () => {
  assert.notEqual(transferIds('a', 'key').out, transferIds('b', 'key').out);
  assert.equal(transferIds('a', 'key').out, transferIds('a', 'key').out);
  assert.throws(() => cashAmount(-1)); assert(cashAmount('0', true).eq(0));
});
test('serialization failures retry with a bounded limit', async () => {
  let attempts = 0;
  const db = { $transaction: async work => { if (++attempts < 3) throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: '7' }); return work(tx); } };
  assert.equal(await serialCashTransaction(db, async () => 'ok'), 'ok'); assert.equal(attempts, 3);
});

test('manual outgoing API enforces balance and cannot impersonate or edit POS movements', async () => {
  reset();
  const manual = data => financeAPI.POST(new NextRequest('http://localhost/api/finance/transactions', { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), accountId: 'cash', amount: '101', direction: 'OUT', ...data }) }));
  assert.equal((await manual({})).status, 409); assert.equal(entries.length, 0);
  assert.equal((await manual({ amount: '5', direction: 'IN', source: 'POS_SALE', orderId: 'order' })).status, 201);
  assert.equal(entries[0].source, 'MANUAL'); assert.equal(entries[0].orderId, undefined);
  assert.equal(financeAPI.PATCH, undefined); assert.equal(financeAPI.DELETE, undefined);
  actor.role = 'CASHIER'; assert.equal((await manual({})).status, 403);
});
test('date-filtered account detail includes the entire Istanbul day and summarizes all matching entries', async () => {
  reset();
  entries = [
    { id: 'sale', accountId: 'cash', branchId: 'a', organizationId: 'org', source: 'POS_SALE', direction: 'IN', amount: D(40), occurredAt: new Date('2026-10-20T21:00:00Z') },
    { id: 'refund', accountId: 'cash', branchId: 'a', organizationId: 'org', source: 'POS_REFUND', direction: 'OUT', amount: D(10), occurredAt: new Date('2026-10-21T20:59:59.999Z') },
    { id: 'outside', accountId: 'cash', branchId: 'a', organizationId: 'org', source: 'MANUAL', direction: 'IN', amount: D(500), occurredAt: new Date('2026-10-21T21:00:00Z') },
    { id: 'other', accountId: 'bank', branchId: 'b', organizationId: 'org', source: 'MANUAL', direction: 'IN', amount: D(900), occurredAt: new Date('2026-10-21T09:00:00Z') },
  ];
  const response = await financeAPI.GET(new NextRequest('http://localhost/api/finance/transactions?accountId=cash&startDate=2026-10-21&endDate=2026-10-21'));
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(result.transactions.map(e => e.id), ['sale', 'refund']);
  assert.deepEqual(result.summary, { incoming: '40', outgoing: '10', net: '30' });
  for (const query of ['startDate=2026-02-30', 'startDate=2026-10-22&endDate=2026-10-21']) assert.equal((await financeAPI.GET(new NextRequest('http://localhost/api/finance/transactions?' + query))).status, 400);
});

test('manual cash movement retries once and does not book the same payment twice', async()=>{
  reset();const key=crypto.randomUUID();
  const send=(amount='5')=>financeAPI.POST(new NextRequest('http://localhost/api/finance/transactions',{method:'POST',body:JSON.stringify({idempotencyKey:key,accountId:'cash',amount,direction:'OUT'})}));
  assert.equal((await send()).status,201);assert.equal((await send()).status,201);assert.equal(entries.length,1);assert.equal(balance('cash').toFixed(2),'95.10');
  assert.equal((await send('6')).status,409);assert.equal(entries.length,1);
});
