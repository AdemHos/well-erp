/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly opt-in PostgreSQL integration with rollback-only fixtures. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('PostgreSQL cari ledger: historical balance before search, date filtering, stable pagination, branch scope, CSV and constraints', {
  skip: process.env.WELLPOS_CURRENT_ACCOUNTS_DB_TEST !== '1', timeout: 120000,
}, async () => {
  require('dotenv').config({ quiet: true });
  require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  const { PrismaClient } = require('../src/generated/prisma/client.ts');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const rollback = new Error('ROLLBACK_CURRENT_ACCOUNT_FIXTURES'), load = Module._load;
  try {
    await assert.rejects(db.$transaction(async tx => {
      const seed = crypto.randomUUID();
      const org = await tx.organization.create({ data: { name: 'Cari integration', slug: 'cari-' + seed } });
      const user = await tx.user.create({ data: { email: seed + '@example.test', name: 'Ledger tester' } });
      const a = await tx.branch.create({ data: { organizationId: org.id, name: 'Visible' } });
      const b = await tx.branch.create({ data: { organizationId: org.id, name: 'Hidden' } });
      const foreign = await tx.organization.create({ data: { name: 'Foreign', slug: 'cari-other-' + seed } });
      const foreignBranch = await tx.branch.create({ data: { organizationId: foreign.id, name: 'Foreign' } });
      const card = await tx.currentAccount.create({ data: { organizationId: org.id, code: 'C001', name: 'Customer', type: 'CUSTOMER' } });
      let sequence = 0;
      const entry = changes => tx.currentAccountEntry.create({ data: {
        id: 'cari-test-' + seed + '-' + String(sequence++).padStart(4, '0'),
        organizationId: org.id, currentAccountId: card.id, branchId: a.id,
        createdByUserId: user.id, kind: 'ADJUSTMENT', direction: 'DEBIT', amount: '100',
        description: 'keep', idempotencyKey: crypto.randomUUID(), requestHash: 'fixture',
        occurredAt: new Date('2026-10-22T09:00:00Z'), createdAt: new Date('2026-10-22T09:00:00Z'), ...changes,
      } });
      await entry({ kind: 'OPENING', amount: '1000', occurredAt: new Date('2026-10-20T09:00:00Z') });
      await entry({});
      await entry({ description: 'excluded by search', direction: 'CREDIT', amount: '40' });
      await entry({ direction: 'CREDIT', amount: '60', occurredAt: new Date('2026-10-22T12:00:00Z') });
      await entry({ amount: '50', occurredAt: new Date('2026-10-23T09:00:00Z') });
      await entry({ amount: '9000', branchId: b.id });
      // Exercise database invariants without aborting the fixture transaction.
      const rejectsConstraint = async changes => {
        await tx.$executeRawUnsafe('SAVEPOINT cari_constraint_test');
        try { await assert.rejects(entry(changes)); }
        finally { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cari_constraint_test'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT cari_constraint_test'); }
      };
      await rejectsConstraint({ amount: '-1' });
      await rejectsConstraint({ kind: 'OPENING' });
      await rejectsConstraint({ branchId: foreignBranch.id });
      const member = { userId: user.id, role: 'MANAGER', organizationId: org.id, allBranches: false, branchAccess: [{ branchId: a.id }] };
      const client = new Proxy(tx, { get(target, key) { return key === '$transaction' ? async work => work(tx) : Reflect.get(target, key, target); } });
      Module._load = function(request, parent, main) {
        if (request === '@/lib/prisma') return { prisma: client };
        if (request === '@/lib/current-membership') return { getCurrentMembership: async () => member };
        if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
        return load.call(this, request, parent, main);
      };
      const statement = require('../src/app/api/current-accounts/[id]/entries/route.ts');
      const csv = require('../src/app/api/current-accounts/[id]/statement.csv/route.ts');
      const listing = require('../src/app/api/current-accounts/route.ts');
      Module._load = load;
      const context = { params: Promise.resolve({ id: card.id }) };
      const get = async query => {
        const response = await statement.GET(new NextRequest('http://localhost/api/current-accounts/' + card.id + '/entries?' + query), context);
        assert.equal(response.status, 200); return response.json();
      };
      const query = 'startDate=2026-10-22&endDate=2026-10-22&q=keep&limit=1';
      const first = await get(query);
      assert.equal(first.pagination.total, 2); assert.equal(first.entries[0].balance, '1100.00');
      assert.equal(first.summary.opening, '1000.00'); assert.equal(first.summary.balance, '1050.00');
      assert.equal(first.summary.debit, '100.00'); assert.equal(first.summary.credit, '60.00');
      const second = await get(query + '&page=2'); assert.equal(second.entries[0].balance, '1000.00');
      const desc = await get(query + '&sort=desc'); assert.equal(desc.entries[0].id, second.entries[0].id);
      const sameTime = await get('startDate=2026-10-22&endDate=2026-10-22'); assert.deepEqual(sameTime.entries.map(e => e.balance), ['1100.00', '1060.00', '1000.00']);
      const exportResponse = await csv.GET(new NextRequest('http://localhost/api/current-accounts/' + card.id + '/statement.csv?' + query), context);
      assert.equal(exportResponse.status, 200); const content = await exportResponse.text(); assert(content.includes('1100.00')); assert(content.includes('1000.00')); assert(!content.includes('Hidden'));
      const listResponse = await listing.GET(new NextRequest('http://localhost/api/current-accounts')); const list = await listResponse.json(); assert.equal(list.accounts[0].balance, '1050');
      assert.equal((await statement.GET(new NextRequest('http://localhost/api/current-accounts/' + card.id + '/entries?branchId=' + b.id), context)).status, 404);
      throw rollback;
    }, { timeout: 110000, isolationLevel: 'RepeatableRead' }), error => error === rollback);
  } finally { Module._load = load; await db.$disconnect(); }
});
