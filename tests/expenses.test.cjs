/* eslint-disable @typescript-eslint/no-require-imports -- Offline API harness, no live database. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { Prisma } = require('../src/generated/prisma/client.ts');
const { NextRequest } = require('next/server');
const D = value => new Prisma.Decimal(value);
let actor, expenses, payments, movements, ledger, audits, categories, accounts, cards, queue, fail, queries;
function reset() {
  actor = { userId: 'owner', profileId: 'profile', role: 'OWNER', organizationId: 'org', allBranches: true, branchAccess: [] };
  expenses = []; payments = []; movements = []; ledger = []; audits = []; queue = Promise.resolve(); fail = ''; queries = [];
  categories = [{ id: 'rent', organizationId: 'org', name: 'Kira', direction: 'OUT', isActive: true }, { id: 'income', organizationId: 'org', name: 'Gelir', direction: 'IN', isActive: true }];
  accounts = [
    { id: 'cash', organizationId: 'org', branchId: 'a', type: 'CASH', name: 'Kasa A', isActive: true, openingBalance: D(20000) },
    { id: 'bank', organizationId: 'org', branchId: 'a', type: 'BANK', name: 'Banka A', isActive: true, openingBalance: D(20000) },
    { id: 'card', organizationId: 'org', branchId: 'a', type: 'CARD', name: 'POS', isActive: true, openingBalance: D(20000) },
    { id: 'cash-b', organizationId: 'org', branchId: 'b', type: 'CASH', name: 'Kasa B', isActive: true, openingBalance: D(20000) },
    { id: 'foreign', organizationId: 'foreign', branchId: 'foreign', type: 'CASH', name: 'Foreign', isActive: true, openingBalance: D(20000) },
  ];
  cards = [{ id: 'supplier', organizationId: 'org', name: 'Tedarikçi', code: 'S1', type: 'SUPPLIER', isActive: true }, { id: 'customer', organizationId: 'org', name: 'Müşteri', code: 'C1', type: 'CUSTOMER', isActive: true }];
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(clause => matches(row, clause));
    if (key === 'reversals') return !ledger.some(e => e.reversalOfId === row.id);
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      return matches(row, value);
    }
    return row[key] === value;
  });
}
const duplicate = () => new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });
function group(rows, by, where) {
  const map = new Map();
  for (const row of rows.filter(row => matches(row, where))) {
    const key = by.map(field => row[field]).join('|');
    const value = map.get(key) || { ...Object.fromEntries(by.map(field => [field, row[field]])), _sum: { amount: D(0) } };
    value._sum.amount = value._sum.amount.plus(row.amount); map.set(key, value);
  }
  return [...map.values()];
}
function details(row) {
  return { ...row, branch: { id: row.branchId, name: 'Şube ' + row.branchId }, category: categories.find(c => c.id === row.categoryId), currentAccount: cards.find(c => c.id === row.currentAccountId) || null,
    payments: payments.filter(p => p.expenseId === row.id).map(p => { const movement = movements.find(m => m.id === p.financeTransactionId); return { ...p, financeTransaction: { ...movement, account: accounts.find(a => a.id === movement.accountId) }, createdBy: { name: 'Owner' }, createdByProfile: { name: 'Profile' } }; }) };
}
const tx = {
  expense: {
    findFirst: async ({ where }) => expenses.find(e => matches(e, where)) || null,
    findFirstOrThrow: async ({ where }) => details(expenses.find(e => matches(e, where))),
    findUnique: async ({ where }) => expenses.find(e => matches(e, where)) || null,
    create: async ({ data }) => {
      if (expenses.some(e => e.organizationId === data.organizationId && e.idempotencyKey === data.idempotencyKey)) throw duplicate();
      const row = { id: 'expense' + (expenses.length + 1), version: 1, cancelledAt: null, cancellationReason: null, createdAt: new Date(), ...data }; expenses.push(row); return row;
    },
    update: async ({ where, data }) => {
      const index = expenses.findIndex(e => matches(e, where)); assert(index >= 0);
      const row = { ...expenses[index], ...data, version: data.version?.increment ? expenses[index].version + data.version.increment : expenses[index].version }; expenses[index] = row; return row;
    },
  },
  payment: {
    findUnique: async ({ where }) => payments.find(p => matches(p, where)) || null,
    count: async ({ where }) => payments.filter(p => matches(p, where)).length,
    aggregate: async ({ where }) => ({ _sum: { amount: payments.filter(p => matches(p, where)).reduce((total, p) => total.plus(p.amount), D(0)) } }),
    create: async ({ data }) => { if (fail === 'payment') throw Error('Injected payment failure'); if (payments.some(p => p.id === data.id)) throw duplicate(); payments.push(data); return data; },
  },
  financeAccount: { findFirst: async ({ where }) => accounts.find(a => matches(a, where)) || null },
  financeCategory: {
    findFirst: async ({ where }) => categories.find(c => matches(c, where)) || null,
    update: async ({ where, data }) => { const index = categories.findIndex(c => matches(c, where)); categories[index] = { ...categories[index], ...data }; return categories[index]; },
  },
  currentAccount: { findFirst: async ({ where }) => cards.find(c => matches(c, where)) || null },
  currentAccountEntry: {
    groupBy: async ({ by, where }) => group(ledger, by, where),
    findFirst: async ({ where }) => ledger.find(e => matches(e, where)) || null,
    create: async ({ data }) => { if (fail === 'ledger') throw Error('Injected ledger failure'); if (ledger.some(e => e.sourceKey === data.sourceKey)) throw duplicate(); const row = { id: 'entry' + (ledger.length + 1), createdAt: new Date(), ...data }; ledger.push(row); return row; },
  },
  financeTransaction: {
    groupBy: async ({ by, where }) => group(movements, by, where),
    create: async ({ data }) => { if (fail === 'finance') throw Error('Injected finance failure'); if (movements.some(m => m.id === data.id)) throw duplicate(); movements.push(data); return data; },
  },
  branch: { findFirst: async ({ where }) => [{ id: 'a', organizationId: 'org' }, { id: 'b', organizationId: 'org' }, { id: 'foreign', organizationId: 'foreign' }].find(b => matches(b, where)) || null },
  auditLog: { create: async ({ data }) => { if (fail === 'audit') throw Error('Injected audit failure'); audits.push(data); return data; } },
  $queryRaw: async query => {
    if (String(query).includes("information_schema.columns")) return [{ ready: false }];
    if (String(query).includes("to_regclass")) return [{ ready: false }];
    queries.push(query); const sql = query.sql;
    const param = marker => { const at = sql.indexOf(marker); return at < 0 ? undefined : query.values[(sql.slice(0, at).match(/\?/g) || []).length]; };
    let rows = expenses.filter(e => e.organizationId === query.values[0]);
    if (sql.includes('AND FALSE')) rows = [];
    if (sql.includes('e."branchId" IN (')) { const at = sql.indexOf('e."branchId" IN ('); const values = sql.slice(at).match(/IN \(([^)]+)\)/)[1]; const begin = (sql.slice(0, at).match(/\?/g) || []).length; const ids = query.values.slice(begin, begin + values.split(',').length); rows = rows.filter(e => ids.includes(e.branchId)); }
    for (const [field, marker] of [['branchId', 'AND e."branchId" = ?'], ['categoryId', 'AND e."categoryId" = ?']]) { const value = param(marker); if (value) rows = rows.filter(e => e[field] === value); }
    const start = param('AND e."expenseDate" >= ?'), end = param('AND e."expenseDate" <= ?'); if (start) rows = rows.filter(e => e.expenseDate >= start); if (end) rows = rows.filter(e => e.expenseDate <= end);
    rows = rows.map(e => { const paid = payments.filter(p => p.expenseId === e.id).reduce((t, p) => t.plus(p.amount), D(0)); return { ...e, paid, remaining: e.amount.minus(paid), paymentStatus: paid.eq(0) ? 'UNPAID' : paid.eq(e.amount) ? 'PAID' : 'PARTIALLY_PAID' }; });
    const status = param('AND "paymentStatus" = ?'); if (status) rows = rows.filter(e => e.paymentStatus === status);
    if (sql.includes('AND "cancelledAt" IS NULL')) rows = rows.filter(e => !e.cancelledAt); if (sql.includes('AND "cancelledAt" IS NOT NULL')) rows = rows.filter(e => e.cancelledAt);
    const q = param('POSITION(lower(?)'); if (q) rows = rows.filter(e => [e.title, e.description, e.reference].join(' ').toLowerCase().includes(q.toLowerCase()));
    if (sql.includes('COUNT(*) AS count')) {
      const live = rows.filter(e => !e.cancelledAt), today = param('"dueDate" < ?'), overdue = live.filter(e => e.remaining.gt(0) && e.dueDate && e.dueDate < today);
      const sum = (data, field) => data.reduce((total, row) => total.plus(row[field]), D(0)).toString();
      return [{ count: BigInt(rows.length), totalAmount: sum(live, 'amount'), paidAmount: sum(live, 'paid'), remainingAmount: sum(live, 'remaining'), overdueAmount: sum(overdue, 'remaining'), overdueCount: BigInt(overdue.length) }];
    }
    const limit = param('LIMIT ?'), skip = param('OFFSET ?');
    return rows.sort((a, b) => b.expenseDate - a.expenseDate || b.id.localeCompare(a.id)).slice(skip, skip + limit).map(e => ({ ...e, amount: e.amount.toString(), paidAmount: e.paid.toString(), remainingAmount: e.remaining.toString() }));
  },
};
const prisma = { ...tx, $transaction: (work, options) => {
  assert(['Serializable', 'RepeatableRead'].includes(options.isolationLevel));
  const run = queue.then(async () => {
    const snapshot = { expenses: [...expenses], payments: [...payments], movements: [...movements], ledger: [...ledger], audits: [...audits], categories: [...categories] };
    try { return await work(tx); } catch (error) { ({ expenses, payments, movements, ledger, audits, categories } = snapshot); throw error; }
  }); queue = run.catch(() => {}); return run;
} };
reset(); const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === '@/lib/prisma') return { prisma };
  if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return load.call(this, request, parent, main);
};
const root = require('../src/app/api/expenses/route.ts'), detail = require('../src/app/api/expenses/[id]/route.ts'), pay = require('../src/app/api/expenses/[id]/payments/route.ts'), cancelAPI = require('../src/app/api/expenses/[id]/cancel/route.ts'), categoryAPI = require('../src/app/api/finance/categories/[id]/route.ts');
const { paymentTotals, todayInIstanbul } = require('../src/lib/expenses.ts');
Module._load = load;
const req = (method, url, body, headers) => new NextRequest('http://localhost' + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = 'expense1') => ({ params: Promise.resolve({ id }) });
const create = (changes = {}) => root.POST(req('POST', '/api/expenses', { title: 'Kira', branchId: 'a', categoryId: 'rent', amount: '10000', expenseDate: '2026-01-01', dueDate: '2026-01-15', idempotencyKey: 'expense_1234567890', ...changes }));
const payment = (changes = {}, id = 'expense1') => pay.POST(req('POST', '/api/expenses/' + id + '/payments', { accountId: 'cash', amount: '3000', idempotencyKey: 'payment_1234567890', ...changes }), ctx(id));
const get = async (id = 'expense1') => (await detail.GET(req('GET', '/api/expenses/' + id), ctx(id))).json();
const update = data => detail.PATCH(req('PATCH', '/api/expenses/expense1', { expectedVersion: expenses[0].version, ...data }), ctx());
const cancel = data => cancelAPI.POST(req('POST', '/api/expenses/expense1/cancel', { expectedVersion: expenses[0].version, reason: 'Hatalı kayıt', ...data }), ctx());
const list = query => root.GET(req('GET', '/api/expenses?' + (query || '')));
const cashBalance = () => movements.filter(m => m.accountId === 'cash').reduce((t, m) => m.direction === 'IN' ? t.plus(m.amount) : t.minus(m.amount), accounts[0].openingBalance);

test('10,000 unpaid expense does not affect cash; 3,000 then 7,000 derives partial and paid states exactly', async () => {
  reset(); assert.equal((await create()).status, 201); assert.equal((await get()).expense.paymentStatus, 'UNPAID'); assert(cashBalance().eq(20000)); assert.equal(movements.length, 0);
  assert.equal((await payment()).status, 201); let e = (await get()).expense; assert.equal(e.paymentStatus, 'PARTIALLY_PAID'); assert.equal(e.paidAmount, '3000'); assert.equal(e.remainingAmount, '7000'); assert(cashBalance().eq(17000));
  assert.equal((await payment({ amount: '7000', idempotencyKey: 'second_1234567890' })).status, 201); e = (await get()).expense; assert.equal(e.paymentStatus, 'PAID'); assert.equal(e.remainingAmount, '0'); assert(cashBalance().eq(10000));
  assert.equal((await payment({ amount: '0.01', idempotencyKey: 'extra_1234567890' })).status, 409); assert.equal(payments.length, 2);
});
test('pay selects exactly the chosen active bank or cash and automatic finance source', async () => {
  reset(); await create(); assert.equal((await payment({ accountId: 'bank', description: 'Banka ödemesi', reference: 'DEKONT-1' })).status, 201);
  assert.equal(movements[0].accountId, 'bank'); assert.equal(movements[0].source, 'EXPENSE_PAYMENT'); assert.equal(movements[0].direction, 'OUT'); assert.equal(movements[0].reference, 'DEKONT-1'); assert.equal(payments[0].financeTransactionId, movements[0].id); assert(cashBalance().eq(20000));
});
test('supplier expense accrues CREDIT once, payments DEBIT and link the same finance transaction once', async () => {
  reset(); assert.equal((await create({ currentAccountId: 'supplier' })).status, 201); assert.equal(ledger.length, 1); assert.equal(ledger[0].direction, 'CREDIT'); assert.equal(ledger[0].kind, 'EXPENSE'); assert.equal(movements.length, 0);
  assert.equal((await payment()).status, 201); assert.equal(ledger.length, 2); assert.equal(ledger[1].direction, 'DEBIT'); assert.equal(ledger[1].financeTransactionId, movements[0].id); assert.equal(payments[0].currentAccountEntryId, ledger[1].id);
  const net = ledger.reduce((t, e) => e.direction === 'DEBIT' ? t.plus(e.amount) : t.minus(e.amount), D(0)); assert(net.eq(-7000));
  assert.equal((await create({ currentAccountId: 'supplier' })).status, 200); assert.equal(ledger.length, 2);
});
test('simultaneous identical payments replay once; changed content conflicts; balance cannot overpay', async () => {
  reset(); await create(); assert.deepEqual((await Promise.all([payment(), payment(), payment()])).map(r => r.status).sort(), [200, 200, 201]); assert.equal(payments.length, 1); assert.equal(movements.length, 1);
  assert.equal((await payment({ amount: '1' })).status, 409);
  const results = await Promise.all([payment({ amount: '5000', idempotencyKey: 'parallel_a_1234567890' }), payment({ amount: '5000', idempotencyKey: 'parallel_b_1234567890' })]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert(payments.reduce((sum, p) => sum.plus(p.amount), D(0)).eq(8000));
});
test('reject wrong-branch, foreign, inactive and CARD/POS accounts, and insufficient funds', async () => {
  reset(); await create(); for (const accountId of ['cash-b', 'foreign', 'card']) assert.equal((await payment({ accountId })).status, 409);
  accounts[0].isActive = false; assert.equal((await payment()).status, 409); accounts[0].isActive = true; accounts[0].openingBalance = D(1); assert.equal((await payment()).status, 409); assert.equal(movements.length, 0);
});
test('unauthorized, foreign organization and limited-branch callers cannot create, read, pay or cancel', async () => {
  reset(); await create(); actor.role = 'CASHIER'; assert.equal((await create()).status, 403); assert.equal((await payment()).status, 403); assert.equal((await list()).status, 403);
  actor = null; assert.equal((await create()).status, 401);
  reset(); await create(); actor.organizationId = 'foreign'; assert.equal((await payment()).status, 404); assert.equal((await update({ title: 'No' })).status, 404); assert.equal((await cancel()).status, 404);
  actor.organizationId = 'org'; actor.role = 'MANAGER'; actor.allBranches = false; actor.branchAccess = [{ branchId: 'b' }]; assert.equal((await payment()).status, 404); assert.equal((await create()).status, 404); assert.equal((await list('branchId=a')).status, 404);
  const data = await (await list()).json(); assert.equal(data.pagination.total, 0);
});
test('reject invalid amounts, direction/source/status spoofing and invalid dates', async () => {
  for (const amount of ['-1', '0', '', 'NaN', 'Infinity', '1.001', '1000000000000', null]) { reset(); assert.equal((await create({ amount })).status, 400); }
  reset(); await create(); for (const amount of ['-1', '0', '1.001']) assert.equal((await payment({ amount })).status, 400);
  for (const changes of [{ source: 'MANUAL' }, { direction: 'IN' }, { currentAccountEntryId: 'fake' }, { paidAt: '2999-01-01' }]) assert.equal((await payment(changes)).status, 400);
  for (const changes of [{ paymentStatus: 'PAID' }, { sourceKey: 'fake' }, { expenseDate: '2026-02-30' }, { dueDate: '2025-12-01' }]) assert.equal((await create(changes)).status, 400);
});
test('paid expense locks amount, supplier, category, branch and accounting date; metadata preserves history', async () => {
  reset(); await create({ currentAccountId: 'supplier' }); await payment(); const savedMovement = { ...movements[0] }, savedEntry = { ...ledger[1] };
  for (const fields of [{ amount: '20000', reason: 'No' }, { currentAccountId: null, reason: 'No' }, { categoryId: 'other' }, { expenseDate: '2026-01-02' }]) assert.equal((await update(fields)).status, 409);
  assert.equal((await update({ branchId: 'b' })).status, 400); assert.equal((await update({ title: 'Yeni başlık', reference: 'NEW', dueDate: '2026-02-01' })).status, 200);
  assert.deepEqual(movements[0], savedMovement); assert.deepEqual(ledger[1], savedEntry); assert.equal((await cancel()).status, 409);
  assert.equal(detail.DELETE, undefined); assert.equal(pay.PATCH, undefined); assert.equal(pay.DELETE, undefined);
});
test('unpaid financial edit reverses old accrual, creates new liability and rejects stale versions', async () => {
  reset(); await create({ currentAccountId: 'supplier' }); const old = { ...ledger[0] };
  assert.equal((await update({ amount: '12000' })).status, 400); assert.equal((await update({ amount: '12000', reason: 'Eksik tutar' })).status, 200);
  assert.equal(ledger.length, 3); assert.deepEqual(ledger[0], old); assert.equal(ledger[1].reversalOfId, old.id); assert.equal(ledger[1].direction, 'DEBIT'); assert.equal(ledger[2].direction, 'CREDIT'); assert(ledger[2].amount.eq(12000)); assert.equal(movements.length, 0);
  assert.equal((await update({ expectedVersion: 1, title: 'stale' })).status, 409);
  assert.equal((await update({ currentAccountId: null, reason: 'Carisiz kayıt' })).status, 200); assert.equal(ledger.length, 4);
});
test('unpaid cancellation is auditable, idempotent and excludes expense from report totals', async () => {
  reset(); await create({ currentAccountId: 'supplier' }); assert.equal((await cancel()).status, 200); assert.equal((await cancel()).status, 200); assert.equal(ledger.length, 2); assert(expenses[0].cancelledAt); assert.equal((await payment()).status, 409);
  assert.equal((await update({ title: 'no' })).status, 409); const live = await (await list()).json(); assert.equal(live.summary.totalAmount, '0'); const all = await (await list('cancelled=include')).json(); assert.equal(all.pagination.total, 1); assert.equal(all.summary.totalAmount, '0');
});
test('report derives expense once, paid and unpaid amounts across pages and payment-status filters', async () => {
  reset(); await create(); await payment(); await create({ title: 'Diğer', amount: '2000', idempotencyKey: 'expense_two_1234567890' });
  let data = await (await list('limit=1')).json(); assert.equal(data.expenses.length, 1); assert.equal(data.summary.totalAmount, '12000'); assert.equal(data.summary.paidAmount, '3000'); assert.equal(data.summary.remainingAmount, '9000'); assert.equal(data.summary.overdueAmount, '9000');
  data = await (await list('status=PARTIALLY_PAID')).json(); assert.equal(data.pagination.total, 1); assert.equal(data.summary.totalAmount, '10000'); assert.equal(data.summary.remainingAmount, '7000');
  data = await (await list('q=Diğer')).json(); assert.equal(data.summary.totalAmount, '2000');
  for (const query of ['status=FAKE', 'cancelled=invalid', 'page=0', 'startDate=2026-02-30']) assert.equal((await list(query)).status, 400);
});
test('payment transaction rolls back finance, current entry and payment on any failed leg or audit', async () => {
  for (const step of ['finance', 'ledger', 'payment', 'audit']) {
    reset(); await create({ currentAccountId: 'supplier' }); fail = step; const log = console.error; console.error = () => {};
    try { assert.equal((await payment()).status, 500); } finally { console.error = log; }
    assert.equal(payments.length, 0); assert.equal(movements.length, 0); assert.equal(ledger.length, 1); assert(cashBalance().eq(20000)); fail = ''; assert.equal((await payment()).status, 201);
  }
});
test('old supplier/category may become inactive without preventing payment; new expense must use active OUT and supplier', async () => {
  reset(); await create({ currentAccountId: 'supplier' }); cards[0].isActive = false; categories[0].isActive = false; assert.equal((await payment()).status, 201); assert.equal((await create({ currentAccountId: 'supplier' })).status, 200);
  assert.equal((await create({ idempotencyKey: 'new_expense_1234567890' })).status, 404);
  categories[0].isActive = true; assert.equal((await create({ currentAccountId: 'customer', idempotencyKey: 'customer_new_1234567890' })).status, 404); assert.equal((await create({ categoryId: 'income', idempotencyKey: 'income_new_1234567890' })).status, 404);
});
test('category edit/deactivation uses existing OUT category and refuses direction changes, income and foreign IDs', async () => {
  reset(); const change = (id, body) => categoryAPI.PATCH(req('PATCH', '/api/finance/categories/' + id, body), { params: Promise.resolve({ id }) });
  assert.equal((await change('rent', { name: 'Ofis kirası', isActive: false })).status, 200); assert.equal(categories[0].direction, 'OUT'); assert.equal(categories[0].isActive, false);
  assert.equal((await change('rent', { direction: 'IN' })).status, 400); assert.equal((await change('income', { name: 'No' })).status, 404); actor.organizationId = 'foreign'; assert.equal((await change('rent', { name: 'No' })).status, 404);
});
test('date boundary, Decimal fractional status and overpayment invariant remain exact', () => {
  assert.equal(todayInIstanbul(new Date('2026-10-21T21:00:00Z')).toISOString(), '2026-10-21T21:00:00.000Z');
  assert.equal(paymentTotals(D('0.30'), [{ amount: D('0.10') }, { amount: D('0.20') }]).paymentStatus, 'PAID'); assert.throws(() => paymentTotals(D('0.29'), [{ amount: D('0.30') }]));
});
