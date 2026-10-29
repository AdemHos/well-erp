/* eslint-disable @typescript-eslint/no-require-imports -- Capture generated SQL with a local pg pool stub; no database connection. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { PrismaClient } = require('../src/generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
test('existing manual cari insert omits expenseId until the approved Expense migration is applied', async () => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@invalid.local/unused' });
  const queries = [];
  const stop = new Error('STOP_OFFLINE_SQL_CAPTURE');
  pool.query = async config => { queries.push(typeof config === 'string' ? config : config.text); throw stop; };
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    await assert.rejects(client.currentAccountEntry.create({ data: {
      organizationId: 'fixture', currentAccountId: 'fixture', branchId: 'fixture', direction: 'DEBIT', kind: 'OPENING', amount: '1', createdByUserId: 'fixture', idempotencyKey: 'fixture', requestHash: 'fixture',
    }, select: { id: true, amount: true } }));
    const sql = queries.find(query => query.includes('INSERT INTO'));
    assert(sql, 'Prisma must issue a captured INSERT without connecting to a database');
    assert(sql.includes('CurrentAccountEntry')); assert(!sql.includes('expenseId'));
  } finally { await client.$disconnect(); }
});
