/* eslint-disable @typescript-eslint/no-require-imports -- Isolated API tests without a database connection. */
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
let actor, cards, entries, audits, failAudit, queue, queries, rawRows, rawSummary;
function reset() {
  actor = { role: 'OWNER', userId: 'owner', organizationId: 'org', allBranches: true, branchAccess: [], profileId: 'profile' };
  cards = []; entries = []; audits = []; failAudit = false; queue = Promise.resolve(); queries = []; rawRows = [];
  rawSummary = { total: 0n, debit: '0', credit: '0', opening: '0', balance: '0', lifetimeDebit: '0', lifetimeCredit: '0' };
}
function match(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => match(row, condition));
    if (key === 'OR') return value.some(condition => match(row, condition));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('contains' in value) return String(row[key] || '').toLowerCase().includes(value.contains.toLowerCase());
      return match(row, value); // Prisma composite unique selectors.
    }
    return row[key] === value;
  });
}
const uniqueError = () => new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' });
const tx = {
  currentAccount: {
    create: async ({ data }) => {
      if (cards.some(c => c.organizationId === data.organizationId && c.code === data.code)) throw uniqueError();
      const card = { id: 'card' + (cards.length + 1), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
      cards.push(card); return card;
    },
    findFirst: async ({ where }) => cards.find(card => match(card, where)) || null,
    findMany: async ({ where, skip = 0, take }) => cards.filter(card => match(card, where)).sort((a, b) => a.code.localeCompare(b.code)).slice(skip, take ? skip + take : undefined),
    count: async ({ where }) => cards.filter(card => match(card, where)).length,
    update: async ({ where, data }) => { const index = cards.findIndex(card => match(card, where)); cards[index] = { ...cards[index], ...data }; return cards[index]; },
  },
  currentAccountEntry: {
    create: async ({ data }) => {
      if (entries.some(e => e.organizationId === data.organizationId && e.idempotencyKey === data.idempotencyKey || data.reversalOfId && e.reversalOfId === data.reversalOfId || data.kind === 'OPENING' && e.kind === 'OPENING' && e.currentAccountId === data.currentAccountId && e.branchId === data.branchId)) throw uniqueError();
      const entry = { id: 'entry' + (entries.length + 1), createdAt: new Date(), financeTransactionId: null, sourceKey: null, ...data };
      entries.push(entry); return entry;
    },
    findFirst: async ({ where }) => entries.find(entry => match(entry, where)) || null,
    findUnique: async ({ where }) => entries.find(entry => match(entry, where)) || null,
    count: async ({ where }) => entries.filter(entry => match(entry, where)).length,
    groupBy: async ({ where }) => {
      const groups = new Map();
      for (const entry of entries.filter(entry => match(entry, where))) {
        const key = entry.currentAccountId + entry.direction;
        const group = groups.get(key) || { currentAccountId: entry.currentAccountId, direction: entry.direction, _sum: { amount: D(0) } };
        group._sum.amount = group._sum.amount.plus(entry.amount); groups.set(key, group);
      }
      return [...groups.values()];
    },
  },
  branch: { findFirst: async ({ where }) => [{ id: 'a', organizationId: 'org' }, { id: 'b', organizationId: 'org' }, { id: 'foreign', organizationId: 'foreign' }].find(branch => match(branch, where)) || null },
  auditLog: { create: async ({ data }) => { if (failAudit) throw Error('Injected audit failure'); audits.push(data); return data; } },
  $queryRaw: async query => { if (String(query).includes("to_regclass")) return [{ ready: false }]; queries.push(query); return query.sql.includes('COUNT(*) AS total') ? [rawSummary] : rawRows; },
};
const prisma = { ...tx, $transaction: (work, options) => {
  assert(['Serializable', 'RepeatableRead'].includes(options.isolationLevel));
  const run = queue.then(async () => {
    const saved = { cards: [...cards], entries: [...entries], audits: [...audits] };
    try { return await work(tx); } catch (error) { cards = saved.cards; entries = saved.entries; audits = saved.audits; throw error; }
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
const listAPI = require('../src/app/api/current-accounts/route.ts');
const cardAPI = require('../src/app/api/current-accounts/[id]/route.ts');
const entryAPI = require('../src/app/api/current-accounts/[id]/entries/route.ts');
const reverseAPI = require('../src/app/api/current-accounts/[id]/entries/[entryId]/reverse/route.ts');
const csvAPI = require('../src/app/api/current-accounts/[id]/statement.csv/route.ts');
const { csvCell, dateInput, signedAmount, cardData } = require('../src/lib/current-accounts.ts');
Module._load = load;
const request = (method, url, body, headers) => new NextRequest('http://localhost' + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = (id = 'card1', entryId) => ({ params: Promise.resolve({ id, entryId }) });
const create = (data = {}) => listAPI.POST(request('POST', '/api/current-accounts', { code: ' c-001 ', name: 'Müşteri', type: 'CUSTOMER', ...data }));
const list = (query = '') => listAPI.GET(request('GET', '/api/current-accounts?' + query));
const patch = (data, id = 'card1') => cardAPI.PATCH(request('PATCH', '/api/current-accounts/' + id, data), context(id));
const add = (data = {}, id = 'card1') => entryAPI.POST(request('POST', '/api/current-accounts/' + id + '/entries', { branchId: 'a', kind: 'OPENING', direction: 'DEBIT', amount: '5000.10', idempotencyKey: 'request_1234567890', ...data }), context(id));
const reverse = (entryId = 'entry1', data = {}) => reverseAPI.POST(request('POST', '/api/current-accounts/card1/entries/' + entryId + '/reverse', { description: 'Hatalı tutar düzeltmesi', idempotencyKey: 'reverse_1234567890', ...data }), context('card1', entryId));

test('create and edit customer, normalize code, retain optional contact/tax fields and actor audit', async () => {
  reset(); assert.equal((await create({ phone: '+90 555', email: 'test@example.com', address: 'Adres', taxOffice: 'Kadıköy', taxNumber: '0123456789' })).status, 201);
  assert.equal(cards[0].code, 'C-001'); assert.equal(cards[0].taxNumber, '0123456789');
  assert.equal((await patch({ name: 'Yeni unvan', description: 'Not', email: null })).status, 200);
  assert.equal(cards[0].name, 'Yeni unvan'); assert.equal(cards[0].email, null); assert.equal(audits.length, 2);
  assert.equal(audits[0].actorUserId, 'owner'); assert.equal(audits[0].actorProfileId, 'profile');
});
test('create supplier and BOTH, enforce normalized duplicate codes within business only', async () => {
  reset(); assert.equal((await create({ type: 'SUPPLIER' })).status, 201);
  assert.equal((await create({ code: 'C-001' })).status, 409);
  actor.organizationId = 'foreign'; assert.equal((await create({ type: 'BOTH' })).status, 201); assert.equal(cards.length, 2);
});
test('opening and debit/credit movements derive exact balances with consistent customer/supplier sides', async () => {
  reset(); await create(); await create({ code: 'S-001', type: 'SUPPLIER' });
  assert.equal((await add()).status, 201);
  assert.equal((await add({ kind: 'ADJUSTMENT', direction: 'CREDIT', amount: '1000.05', description: 'Düzeltme', idempotencyKey: 'adjust_1234567890' })).status, 201);
  assert.equal((await add({ direction: 'CREDIT', amount: '3000.25', idempotencyKey: 'supplier_1234567890' }, 'card2')).status, 201);
  const data = await (await list()).json();
  assert.equal(data.accounts[0].totalDebit, '5000.1'); assert.equal(data.accounts[0].totalCredit, '1000.05'); assert.equal(data.accounts[0].balance, '4000.05');
  assert.equal(data.accounts[0].balanceSide, 'RECEIVABLE'); assert.equal(data.accounts[1].balanceSide, 'PAYABLE');
  assert.equal(data.summary.receivable, '4000.05'); assert.equal(data.summary.payable, '3000.25');
  assert.equal(entries[0].createdByUserId, 'owner'); assert.equal(entries[0].createdByProfileId, 'profile');
});
test('reject zero, negative, malformed, excessive precision/range amounts and forged integration fields', async () => {
  reset(); await create();
  for (const amount of ['-1', '0', '', 'NaN', 'Infinity', '1.001', '1000000000000', null, {}]) assert.equal((await add({ amount })).status, 400);
  for (const body of [{ direction: ['DEBIT'] }, { kind: ['OPENING'] }, { kind: 'COLLECTION' }, { sourceKey: 'fake' }, { financeTransactionId: 'fake' }, { createdByUserId: 'fake' }, { amount: '1', kind: 'ADJUSTMENT' }]) assert.equal((await add(body)).status, 400);
  assert.equal(entries.length, 0);
});
test('opening is unique per account/branch and concurrent identical requests replay once', async () => {
  reset(); await create(); const responses = await Promise.all([add(), add(), add()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 201]); assert.equal(entries.length, 1);
  assert.equal((await add({ idempotencyKey: 'different_1234567890' })).status, 409);
  assert.equal((await add({ branchId: 'b', idempotencyKey: 'branch_b_1234567890' })).status, 201);
  assert.equal((await add({ amount: '5' })).status, 409);
});
test('financial history survives deactivation, new movements stop, reversal stays audited and cannot repeat', async () => {
  reset(); await create(); await add(); assert.equal((await patch({ isActive: false })).status, 200);
  assert.equal((await add({ kind: 'ADJUSTMENT', description: 'Yeni', idempotencyKey: 'next_123456789012' })).status, 409);
  assert.equal((await reverse()).status, 201); assert.equal((await reverse()).status, 200);
  assert.equal((await reverse('entry1', { idempotencyKey: 'reverse_other_1234567890' })).status, 409);
  assert.equal((await reverse('entry2', { idempotencyKey: 'reverse_chain_1234567890' })).status, 409);
  assert.equal(entries.length, 2); assert(entries[0].amount.eq(entries[1].amount)); assert.equal(entries[1].direction, 'CREDIT');
  assert.equal(entries[1].reversalOfId, 'entry1'); assert.equal((await (await list()).json()).accounts[0].balance, '0');
  assert.equal(cardAPI.DELETE, undefined); assert.equal(entryAPI.PATCH, undefined); assert.equal(entryAPI.DELETE, undefined);
});
test('reversal requires reason, rejects earlier date and cannot independently reverse a linked payment', async () => {
  reset(); await create(); await add({ occurredAt: '2026-10-22' });
  assert.equal((await reverse('entry1', { description: '' })).status, 400);
  assert.equal((await reverse('entry1', { occurredAt: '2026-10-21' })).status, 400);
  entries[0].financeTransactionId = 'cash-entry'; assert.equal((await reverse()).status, 409);
  assert.equal(entries.length, 1);
});
test('foreign tenant cannot read or edit card, add/reverse movement or export statement', async () => {
  reset(); await create(); await add(); actor.organizationId = 'foreign';
  assert.equal((await cardAPI.GET(request('GET', '/api/current-accounts/card1'), context())).status, 404);
  assert.equal((await patch({ name: 'No' })).status, 404); assert.equal((await add()).status, 404); assert.equal((await reverse()).status, 404);
  assert.equal((await csvAPI.GET(request('GET', '/api/current-accounts/card1/statement.csv'), context())).status, 404);
  assert.equal((await (await list()).json()).accounts.length, 0);
});
test('unauthenticated and cashiers cannot create cards, post movements or read finance statements', async () => {
  reset(); await create(); actor.role = 'CASHIER';
  assert.equal((await create()).status, 403); assert.equal((await add()).status, 403); assert.equal((await list()).status, 403);
  actor = null; assert.equal((await create()).status, 401); assert.equal((await add()).status, 401);
});
test('branch scope applies to openings, adjustments, balances, reversals and CSV even without explicit filter', async () => {
  reset(); await create(); await add(); await add({ branchId: 'b', direction: 'CREDIT', idempotencyKey: 'branch_b_1234567890' });
  actor.role = 'MANAGER'; actor.allBranches = false; actor.branchAccess = [{ branchId: 'a' }];
  assert.equal((await add({ branchId: 'b' })).status, 404); assert.equal((await reverse('entry2')).status, 404);
  const data = await (await list()).json(); assert.equal(data.accounts[0].totalCredit, '0');
  assert.equal((await entryAPI.GET(request('GET', '/api/current-accounts/card1/entries?branchId=b'), context())).status, 404);
  assert.equal((await csvAPI.GET(request('GET', '/api/current-accounts/card1/statement.csv?branchId=b'), context())).status, 404);
  await entryAPI.GET(request('GET', '/api/current-accounts/card1/entries'), context());
  assert(queries.every(query => query.sql.includes('e."branchId" IN (?)') && query.values.includes('a') && !query.values.includes('b')));
  actor.branchAccess = []; queries = []; await csvAPI.GET(request('GET', '/api/current-accounts/card1/statement.csv'), context());
  assert(queries.every(query => query.sql.includes('AND FALSE')));
});
test('list filters, pagination and BOTH inclusion do not change summary scope', async () => {
  reset(); await create(); await create({ code: 'S-002', name: 'Tedarikçi', type: 'SUPPLIER', isActive: false }); await create({ code: 'B-003', type: 'BOTH' });
  const result = await (await list('type=CUSTOMER&active=true&limit=1')).json(); assert.equal(result.accounts.length, 1); assert.equal(result.pagination.total, 2); assert.equal(result.summary.activeCount, 2);
  assert.equal((await (await list('q=Tedarikçi')).json()).accounts[0].code, 'S-002');
  for (const query of ['page=0', 'page=Infinity', 'limit=101', 'type=INVALID', 'active=invalid']) assert.equal((await list(query)).status, 400);
});
test('audit failure rolls back account and ledger writes; retry after failure works', async () => {
  reset(); failAudit = true; const log = console.error; console.error = () => {};
  try { assert.equal((await create()).status, 500); assert.equal(cards.length, 0); failAudit = false; await create(); failAudit = true; assert.equal((await add()).status, 500); assert.equal(entries.length, 0); }
  finally { console.error = log; failAudit = false; }
  assert.equal((await add()).status, 201);
});
test('statement query computes window before filters, uses stable full order, and parameterizes search and dates', async () => {
  reset(); await create();
  const url = '/api/current-accounts/card1/entries?startDate=2026-10-22&endDate=2026-10-22&sort=desc&page=2&limit=1&q=' + encodeURIComponent("x' OR TRUE --");
  assert.equal((await entryAPI.GET(request('GET', url), context())).status, 200);
  const query = queries[1];
  assert(query.sql.indexOf('OVER (ORDER BY') < query.sql.indexOf('filtered AS'));
  assert(query.sql.includes('ORDER BY "occurredAt" DESC, "createdAt" DESC, id DESC'));
  assert(query.sql.includes('LIMIT ? OFFSET ?')); assert(query.values.includes("x' OR TRUE --")); assert(!query.sql.includes("x' OR TRUE"));
  assert(query.values.some(v => v instanceof Date && v.toISOString() === '2026-10-21T21:00:00.000Z'));
  assert(query.values.some(v => v instanceof Date && v.toISOString() === '2026-10-22T20:59:59.999Z'));
  for (const filter of ['startDate=2026-02-30', 'startDate=2026-10-23&endDate=2026-10-22', 'sort=unsafe']) assert.equal((await entryAPI.GET(request('GET', '/api/current-accounts/card1/entries?' + filter), context())).status, 400);
});
test('CSV exports unpaginated statement with BOM, debit/credit, historical balance and formula escaping', async () => {
  reset(); await create(); rawSummary.opening = '100'; rawRows = [{ id: 'one', kind: 'ADJUSTMENT', direction: 'CREDIT', amount: '25.10', balance: '74.90', description: '=HYPERLINK("evil")', reference: 'a;b', occurredAt: new Date('2026-10-22T09:00:00Z'), branchName: 'A', createdByName: 'Owner', reversalOfId: null }];
  const response = await csvAPI.GET(request('GET', '/api/current-accounts/card1/statement.csv?limit=1'), context());
  assert.equal(response.status, 200); assert(response.headers.get('content-type').includes('text/csv'));
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const content = new TextDecoder().decode(bytes); assert(content.includes("'=HYPERLINK")); assert(content.includes('74.90')); assert(content.includes('"a;b"')); assert(content.includes('Tarih öncesi devir'));
  assert(!queries[1].sql.includes('LIMIT ?'));
});
test('dates, signed Decimal values, tax validation and CSV cells are strict', () => {
  assert.equal(dateInput('2026-10-22', true).toISOString(), '2026-10-22T20:59:59.999Z');
  assert.throws(() => dateInput('2026-02-30')); assert.throws(() => dateInput('2026-10-22T15:00:00'));
  assert(signedAmount({ direction: 'DEBIT', amount: D('0.10') }).plus(signedAmount({ direction: 'CREDIT', amount: D('0.05') })).eq('0.05'));
  assert.throws(() => cardData({ code: 'C1', name: 'Name', type: 'CUSTOMER', taxNumber: '123' }));
  for (const cell of ['=cmd', '+cmd', '-cmd', '@cmd', '  =cmd', '\tcmd']) assert(csvCell(cell).startsWith('"\''));
});
