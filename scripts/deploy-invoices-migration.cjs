/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly approved invoices-only Neon migration. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const root = path.resolve(__dirname, '..');
const target = '20261022020000_add_invoices';
const expected = '197449eabe2ad66399f61c127d4340b50ad9543aed3607b7175299a546aac3e8';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = text => '"' + text.replaceAll('"', '""') + '"';
async function snapshot(client, tables) {
  const result = {};
  for (const table of tables) {
    if (table.tablename === '_prisma_migrations') continue;
    const name = quote(table.schemaname) + '.' + quote(table.tablename);
    const [row] = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)),'')) AS digest FROM ${name} t`)).rows;
    result[table.schemaname + '.' + table.tablename] = row;
  }
  return result;
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith('.neon.tech')) throw Error('Expected configured Neon source');
  url.hostname = url.hostname.replace('-pooler.', '.'); url.searchParams.set('sslmode', 'verify-full');
  const backupDir = path.join(root, '.backups/wellpos-before-invoices-2026-10-22T00-10-26-702Z');
  const backup = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  if (backup.validation.restoreToDatabase !== 'PASS' || !backup.validation.allTableRowCountsMatch || hash(fs.readFileSync(path.join(backupDir, 'wellpos.dump'))) !== backup.sha256) throw Error('Verified backup requirement failed');
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations', target, 'migration.sql'));
  if (hash(migration) !== expected || !migration.equals(fs.readFileSync(path.join(root, 'docs/migrations/invoices.sql')))) throw Error('Approved migration checksum changed');
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000 });
  try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if ((await client.query('SELECT current_database() AS db')).rows[0].db !== backup.sourceDatabase) throw Error('Backup database mismatch');
    const migrations = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')).rows;
    if (migrations.some(m => !m.finished_at && !m.rolled_back_at)) throw Error('Unfinished migration exists');
    const applied = migrations.filter(m => m.finished_at && !m.rolled_back_at);
    for (const record of applied) if (hash(fs.readFileSync(path.join(root, 'prisma/migrations', record.migration_name, 'migration.sql'))) !== record.checksum) throw Error('Existing migration checksum mismatch: ' + record.migration_name);
    const local = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(n => fs.existsSync(path.join(root, 'prisma/migrations', n, 'migration.sql'))).sort();
    const pending = local.filter(n => !applied.some(m => m.migration_name === n));
    if (pending.length !== 1 || pending[0] !== target) throw Error('Pending migrations differ from approved single invoice migration');
    if ((await client.query(`SELECT to_regclass('public."Invoice"') AS invoice`)).rows[0].invoice) throw Error('Invoice table already exists before pending migration');
    const tables = (await client.query("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname,tablename")).rows;
    const before = await snapshot(client, tables);
    await client.query('ROLLBACK');
    const preflight = { checkedAt: new Date().toISOString(), approvedMigration: target, sha256: expected, verifiedBackup: path.relative(root, backupDir), appliedMigrationCount: applied.length, pending, tableData: before };
    fs.writeFileSync(path.join(root, 'docs/migrations/invoices-preflight.json'), JSON.stringify(preflight, null, 2));
    console.log('Preflight PASS: verified backup; all prior checksums match; only approved invoice migration pending.');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
      child.on('error', reject); child.on('close', code => { if (code === 0) resolve(); else { fs.writeFileSync(path.join(backupDir, 'migration-error.txt'), output.replaceAll(url.toString(), '[REDACTED_URL]')); reject(Error('Prisma deploy failed; private diagnostic retained in backup directory')); } });
    });
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const after = await snapshot(client, tables);
    const differences = Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
    const installed = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY started_at')).rows;
    const record = installed.find(m => m.migration_name === target);
    if (!record?.finished_at || record.checksum !== expected) throw Error('Applied invoice migration checksum/state failed');
    const constraints = (await client.query(`SELECT conname, convalidated FROM pg_constraint WHERE conrelid IN ('"Invoice"'::regclass,'"InvoiceItem"'::regclass,'"InvoicePaymentAllocation"'::regclass) ORDER BY conname`)).rows;
    const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Invoice','InvoiceItem','InvoicePaymentAllocation') ORDER BY indexname`)).rows;
    if (constraints.some(c => !c.convalidated) || !indexes.some(i => i.indexname === 'Invoice_sales_number_unique') || !indexes.some(i => i.indexname === 'Invoice_purchase_number_unique')) throw Error('Invoice constraints/indexes verification failed');
    const newTableCounts = {};
    for (const name of ['Invoice','InvoiceItem','InvoicePaymentAllocation']) newTableCounts[name] = (await client.query(`SELECT count(*)::text AS count FROM ${quote(name)}`)).rows[0].count;
    const nullableExpenseId = (await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ExpensePayment' AND column_name='expenseId'`)).rows[0]?.is_nullable === 'YES';
    if (!nullableExpenseId) throw Error('Shared Payment nullable expenseId migration failed');
    await client.query('ROLLBACK');
    const verification = { verifiedAt: new Date().toISOString(), migration: target, sha256: expected, appliedMigrationCount: installed.length, allExistingBusinessTablesUnchanged: differences.length === 0, changedTables: differences, existingTableData: after, newTableCounts, nullableExpenseId, constraints, indexes, liveMigrationApplied: true };
    fs.writeFileSync(path.join(root, 'docs/migrations/invoices-verification.json'), JSON.stringify(verification, null, 2));
    console.log(JSON.stringify({ migration: target, appliedMigrationCount: installed.length, allExistingBusinessTablesUnchanged: differences.length === 0, changedTables: differences, newTableCounts, constraintsValidated: true, nullableExpenseId }));
    if (differences.length) throw Error('Existing table data changed during deployment; inspect verification report (concurrent business writes are possible)');
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}
main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_URL]')); process.exitCode = 1; });
