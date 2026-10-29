/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly opt-in SQL/API verification using rollback-only fixtures. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('PostgreSQL expenses: partial payments, cash/cari atomicity, exact reports, replay, edits and isolation', { skip: process.env.WELLPOS_EXPENSES_DB_TEST !== '1', timeout: 120000 }, async () => {
  require('dotenv').config({ quiet: true });
  require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  const { PrismaClient } = require('../src/generated/prisma/client.ts');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const rollback = new Error('ROLLBACK_EXPENSE_FIXTURES'), load = Module._load, log = console.error;
  try {
    await assert.rejects(db.$transaction(async tx => {
      const seed = crypto.randomUUID();
      const org = await tx.organization.create({ data: { name: 'Expense test', slug: 'expense-check-' + seed } });
      const user = await tx.user.create({ data: { email: seed + '@example.test', name: 'Expense tester' } });
      const a = await tx.branch.create({ data: { name: 'A', organizationId: org.id } });
      const b = await tx.branch.create({ data: { name: 'B', organizationId: org.id } });
      const category = await tx.financeCategory.create({ data: { organizationId: org.id, name: 'Rent', direction: 'OUT' } });
      const supplier = await tx.currentAccount.create({ data: { organizationId: org.id, code: 'S1', name: 'Supplier', type: 'SUPPLIER' } });
      const cash = await tx.financeAccount.create({ data: { organizationId: org.id, branchId: a.id, name: 'Cash A', type: 'CASH', openingBalance: 20000 } });
      const cashB = await tx.financeAccount.create({ data: { organizationId: org.id, branchId: b.id, name: 'Cash B', type: 'CASH', openingBalance: 20000 } });
      const card = await tx.financeAccount.create({ data: { organizationId: org.id, branchId: a.id, name: 'POS', type: 'CARD', openingBalance: 20000 } });
      let actor = { userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] }, failPayment = false;
      const transaction = async work => {
        await tx.$executeRawUnsafe('SAVEPOINT expense_api_test');
        try {
          const guarded = new Proxy(tx, { get(target, key) { if (key === 'payment' && failPayment) return new Proxy(target.payment, { get(delegate, member) { return member === 'create' ? async () => { throw Error('Injected payment failure'); } : Reflect.get(delegate, member, delegate); } }); return Reflect.get(target, key, target); } });
          const value = await work(guarded); await tx.$executeRawUnsafe('RELEASE SAVEPOINT expense_api_test'); return value;
        } catch (error) { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expense_api_test'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT expense_api_test'); throw error; }
      };
      const client = new Proxy(tx, { get(target, key) { return key === '$transaction' ? transaction : Reflect.get(target, key, target); } });
      Module._load = function(request, parent, main) {
        if (request === '@/lib/prisma') return { prisma: client };
        if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
        if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
        return load.call(this, request, parent, main);
      };
      const root = require('../src/app/api/expenses/route.ts'), detail = require('../src/app/api/expenses/[id]/route.ts'), pay = require('../src/app/api/expenses/[id]/payments/route.ts'), cancellation = require('../src/app/api/expenses/[id]/cancel/route.ts'), statement = require('../src/app/api/current-accounts/[id]/entries/route.ts');
      Module._load = load;
      const request = (method, url, body) => new NextRequest('http://localhost' + url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const input = { title: 'Rent fixture', amount: '10000', categoryId: category.id, branchId: a.id, currentAccountId: supplier.id, expenseDate: '2026-01-01', dueDate: '2026-01-15', reference: 'RENT-TEST', idempotencyKey: crypto.randomUUID() };
      let response = await root.POST(request('POST', '/api/expenses', input)); assert.equal(response.status, 201); const id = (await response.json()).expense.id;
      const context = { params: Promise.resolve({ id }) };
      const get = async () => { const r = await detail.GET(request('GET', '/api/expenses/' + id), context); assert.equal(r.status, 200); return (await r.json()).expense; };
      assert.equal((await get()).paymentStatus, 'UNPAID'); assert.equal(await tx.financeTransaction.count({ where: { organizationId: org.id } }), 0);
      const accrual = await tx.currentAccountEntry.findFirstOrThrow({ where: { expenseId: id } }); assert.equal(accrual.direction, 'CREDIT'); assert(accrual.amount.eq(10000));
      const paymentBody = { accountId: cash.id, amount: '3000', description: 'First installment', idempotencyKey: crypto.randomUUID() };
      const postPayment = body => pay.POST(request('POST', '/api/expenses/' + id + '/payments', { ...paymentBody, ...body }), context);
      failPayment = true; console.error = () => {};
      try { assert.equal((await postPayment({})).status, 500); } finally { failPayment = false; console.error = log; }
      assert.equal(await tx.financeTransaction.count({ where: { organizationId: org.id } }), 0); assert.equal(await tx.currentAccountEntry.count({ where: { expenseId: id } }), 1);
      assert.equal((await postPayment({})).status, 201); assert.equal((await postPayment({})).status, 200);
      assert.equal((await get()).remainingAmount, '7000'); assert.equal((await get()).paymentStatus, 'PARTIALLY_PAID');
      const reportResponse = await root.GET(request('GET', '/api/expenses?limit=1')); assert.equal(reportResponse.status, 200); const report = await reportResponse.json(); assert.equal(report.summary.totalAmount, '10000.00'); assert.equal(report.summary.paidAmount, '3000.00'); assert.equal(report.summary.remainingAmount, '7000.00');
      for (const accountId of [cashB.id, card.id]) assert.equal((await postPayment({ accountId, idempotencyKey: crypto.randomUUID() })).status, 409);
      assert.equal((await postPayment({ amount: '7000', idempotencyKey: crypto.randomUUID() })).status, 201);
      assert.equal((await get()).paymentStatus, 'PAID'); assert.equal((await get()).remainingAmount, '0'); assert.equal((await postPayment({ amount: '0.01', idempotencyKey: crypto.randomUUID() })).status, 409);
      const outgoing = await tx.financeTransaction.aggregate({ where: { organizationId: org.id, accountId: cash.id, direction: 'OUT' }, _sum: { amount: true } }); assert(outgoing._sum.amount.eq(10000));
      const cashEntries = await tx.financeTransaction.findMany({ where: { organizationId: org.id } }); assert.equal(cashEntries.length, 2); assert(cashEntries.every(e => e.source === 'EXPENSE_PAYMENT'));
      const ledger = await tx.currentAccountEntry.findMany({ where: { expenseId: id } }); assert(ledger.reduce((sum, e) => e.direction === 'DEBIT' ? sum.plus(e.amount) : sum.minus(e.amount), new (require('../src/generated/prisma/client.ts').Prisma.Decimal)(0)).eq(0));
      const current = await get(); response = await detail.PATCH(request('PATCH', '/api/expenses/' + id, { expectedVersion: current.version, amount: '12000', reason: 'No' }), context); assert.equal(response.status, 409);
      response = await statement.GET(request('GET', '/api/current-accounts/' + supplier.id + '/entries'), { params: Promise.resolve({ id: supplier.id }) }); assert.equal(response.status, 200); const ledgerView = await response.json(); assert.equal(ledgerView.summary.balance, '0.00'); assert.equal(ledgerView.entries.length, 3);
      actor = { ...actor, role: 'CASHIER' }; assert.equal((await root.POST(request('POST', '/api/expenses', input))).status, 403);
      actor = { ...actor, role: 'MANAGER', allBranches: false, branchAccess: [{ branchId: b.id }] }; assert.equal((await detail.GET(request('GET', '/api/expenses/' + id), context)).status, 404);
      actor = { ...actor, role: 'OWNER' };
      response = await root.POST(request('POST', '/api/expenses', { ...input, idempotencyKey: crypto.randomUUID() })); const unpaidId = (await response.json()).expense.id; const unpaidContext = { params: Promise.resolve({ id: unpaidId }) };
      assert.equal((await cancellation.POST(request('POST', '/api/expenses/' + unpaidId + '/cancel', { expectedVersion: 1, reason: 'Duplicate fixture' }), unpaidContext)).status, 200);
      assert.equal(await tx.payment.count({ where: { organizationId: org.id } }), 2);
      throw rollback;
    }, { timeout: 110000, isolationLevel: 'Serializable' }), error => error === rollback);
  } finally { Module._load = load; console.error = log; await db.$disconnect(); }
});
