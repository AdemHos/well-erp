/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript harness; no network or database. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
let query, orderQuery, selectedBranch = 'branch-a';
const db = { $queryRaw: async (strings, ...values) => { query = { sql: strings.join('?'), values }; return []; }, order: { findMany: async args => { orderQuery = args; return []; } }, $transaction: async work => work(db) };
const original = Module._load;
Module._load = function (request, parent, main) {
  if (request === '@/lib/prisma') return { prisma: db };
  if (request === '@/lib/order-access') return { getOrderBranchId: async () => selectedBranch };
  if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
  return original.call(this, request, parent, main);
};
const { dashboardPeriod, dashboardMetrics, loadDashboard } = require('../src/lib/dashboard-data.ts');
const { credentialsInput } = require('../src/lib/auth-input.ts');
const { consumeRateLimit } = require('../src/lib/rate-limit.ts');
const { boundedJson, assertSameOrigin } = require('../src/lib/http-security.ts');
const { clientAttempt } = require('../src/lib/client-attempt.ts');
Module._load = original;

test('dashboard uses Istanbul day boundaries, exact totals, average, yesterday and empty chart slots', () => {
  const now = new Date('2026-10-27T21:05:00Z');
  assert.equal(dashboardPeriod(now).day, '2026-10-28');
  assert.equal(dashboardPeriod(now).start.toISOString(), '2026-10-27T21:00:00.000Z');
  const result = dashboardMetrics([{ bucket: '2026-10-28 00', total: '10.10', count: '2' }, { bucket: '2026-10-28 13', total: '20.20', count: '1' }, { bucket: '2026-10-27 10', total: '15.15', count: '3' }], now);
  assert.equal(result.total, '30.30'); assert.equal(result.count, 3); assert.equal(result.average, '10.10');
  assert.equal(result.changes.total, 100); assert.equal(result.changes.count, 0);
  assert.equal(result.charts.today.length, 24); assert.equal(result.charts.today[0].sales, 10.1);
  assert.equal(result.charts.week.length, 7); assert.equal(result.charts.month.length, 30);
  const empty = dashboardMetrics([], now); assert.equal(empty.total, '0.00'); assert.equal(empty.average, '0.00'); assert.equal(empty.changes.total, undefined);
});
test('dashboard SQL and recent sales are bounded to the authorized organization and active branch', async () => {
  const actor = { organizationId: 'org-a', role: 'OWNER' };
  const result = await loadDashboard(actor);
  assert.deepEqual(query.values.slice(0, 2), ['org-a', 'branch-a']);
  assert.match(query.sql, /status='COMPLETED'/);
  assert.deepEqual(orderQuery.where, { organizationId: 'org-a', branchId: 'branch-a' });
  assert.equal(orderQuery.take, 5); assert.deepEqual(result.orders, []);
  await assert.rejects(loadDashboard({ ...actor, role: 'CASHIER' }), /ACCESS_DENIED/);
  selectedBranch = null; query = null; assert.equal((await loadDashboard(actor)).total, '0.00'); assert.equal(query, null); selectedBranch = 'branch-a';
});
test('credentials reject malformed types, invalid email and bcrypt truncation; normalize valid accounts', () => {
  for (const body of [null, [], { email: 3, password: 'longpassword' }, { email: 'bad', password: 'longpassword' }, { email: 'a@b.test', password: 'ü'.repeat(37), name: 'A' }, { email: 'a@b.test', password: 'short', name: 'A' }]) assert.throws(() => credentialsInput(body, true));
  assert.deepEqual(credentialsInput({ name: ' Ada ', email: ' ADA@B.TEST ', password: 'valid-pass' }, true), { name: 'Ada', email: 'ada@b.test', password: 'valid-pass' });
});
test('rate limiting is bounded by scope and identity and expires', () => {
  const identity = crypto.randomUUID();
  consumeRateLimit('test', identity, 2, 1000, 1000); consumeRateLimit('test', identity, 2, 1000, 1100);
  assert.throws(() => consumeRateLimit('test', identity, 2, 1000, 1200), e => e.status === 429);
  consumeRateLimit('test', identity + '-other', 2, 1000, 1200); consumeRateLimit('test', identity, 2, 1000, 2000);
});
test('body limits reject oversized cloned streams without waiting on the original request', async () => {
  const request = new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(100) }) });
  await assert.rejects(boundedJson(request.clone(), 20), e => e.status === 413);
  assert.deepEqual(await boundedJson(new Request('http://localhost/api', { method: 'POST', body: '{"ok":true}' })), { ok: true });
  assert.throws(() => assertSameOrigin(new Request('http://localhost/api', { headers: { 'sec-fetch-site': 'cross-site' } })), e => e.status === 403);
});
test('a client retry retains its key; a different payload receives a new key', () => {
  const first = clientAttempt(null, { total: 1 });
  assert.equal(clientAttempt(first, { total: 1 }).key, first.key);
  assert.notEqual(clientAttempt(first, { total: 2 }).key, first.key);
});

test('optional JSON accepts an empty streamed POST but still rejects malformed JSON and strict registration bodies', async () => {
  const empty = () => new Request('http://localhost/api', { method: 'POST', body: '' });
  assert.equal(await boundedJson(empty(), 65536, true), null);
  await assert.rejects(boundedJson(empty()), e => e.status === 400);
  await assert.rejects(boundedJson(new Request('http://localhost/api', { method: 'POST', body: '{bad' }), 65536, true), e => e.status === 400);
});

test('origin guard accepts the browser Host behind a Next.js internal bind address and rejects forged origins', () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request('http://0.0.0.0:3000/api/auth/register', { headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request('http://localhost:3000/api/auth/register', { headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } })));
  for (const headers of [
    { host: 'localhost:3000', origin: 'http://evil.test' },
    { host: 'localhost:3000', origin: 'http://localhost:3001' },
    { host: 'localhost:3000', origin: 'null' },
    { host: 'localhost:3000', origin: 'https://evil.test', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
    { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
  ]) assert.throws(() => assertSameOrigin(new Request('http://0.0.0.0:3000/api/auth/register', { headers })), e => e.status === 403);
});
