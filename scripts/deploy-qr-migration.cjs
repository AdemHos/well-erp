/* eslint-disable @typescript-eslint/no-require-imports -- User-approved single qr-service migration; verified fresh backup is mandatory. */
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const checks = require('./qr-deployment-checks.cjs');
require('dotenv').config({ quiet: true });
const root = path.resolve(__dirname, '..');
function redact(value) {
  let text = String(value).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_URL]');
  if (process.env.DATABASE_URL) {
    const source = new URL(process.env.DATABASE_URL);
    for (const secret of [source.password, decodeURIComponent(source.password)]) if (secret) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text;
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith('.neon.tech')) throw Error('Expected configured Neon source');
  url.hostname = url.hostname.replace('-pooler.', '.');
  url.searchParams.set('sslmode', 'verify-full');
  const backupDir = path.resolve(root, process.argv[2] || '');
  const boundary = path.join(root, '.backups') + path.sep;
  if (!backupDir.startsWith(boundary) || !path.basename(backupDir).startsWith('wellpos-before-qr-service-')) throw Error('Explicit qr-service backup directory required');
  const backup = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  const age = Date.now() - Date.parse(backup.completedAt);
  if (!Number.isFinite(age) || age < 0 || age > 2 * 60 * 60 * 1000) throw Error('A fresh backup within two hours is required');
  if (backup.label !== 'before-qr-service' || backup.validation.restoreToDatabase !== 'PASS' || !backup.validation.allTableRowCountsMatch || backup.validation.qrMigrationRehearsal !== 'PASS' || backup.validation.qrMigrationSha256 !== checks.expected || checks.hash(fs.readFileSync(path.join(backupDir, 'wellpos.dump'))) !== backup.sha256) throw Error('Verified backup/rehearsal requirement failed');
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
  if (checks.hash(sql) !== checks.expected || !sql.equals(fs.readFileSync(path.join(root, 'docs/migrations/qr-service.sql')))) throw Error('Approved migration checksum changed');
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if ((await client.query('SELECT current_database() AS db')).rows[0].db !== backup.sourceDatabase) throw Error('Backup database mismatch');
    const migrations = (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')).rows;
    if (migrations.some(m => !m.finished_at && !m.rolled_back_at)) throw Error('Unfinished migration exists');
    const applied = migrations.filter(m => m.finished_at && !m.rolled_back_at);
    for (const m of applied) if (checks.hash(fs.readFileSync(path.join(root, 'prisma/migrations', m.migration_name, 'migration.sql'))) !== m.checksum) throw Error('Prior migration checksum mismatch: ' + m.migration_name);
    const local = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(n => fs.existsSync(path.join(root, 'prisma/migrations', n, 'migration.sql'))).sort();
    const pending = local.filter(n => !applied.some(m => m.migration_name === n));
    if (pending.length !== 1 || pending[0] !== checks.target) throw Error('Only the approved qr-service migration may be pending');
    if (JSON.stringify(applied.map(m => [m.migration_name, m.checksum]).sort()) !== JSON.stringify(backup.migrations.map(m => [m.migration_name, m.checksum]).sort())) throw Error('Schema has changed since backup');
    if ((await client.query("SELECT to_regclass('public.\"BranchQrMenu\"') AS name")).rows[0].name) throw Error('QR settings table already exists');
    const inventory = await checks.tables(client);
    const before = await checks.snapshot(client, inventory);
    await client.query('ROLLBACK');
    fs.writeFileSync(path.join(root, 'docs/migrations/qr-service-preflight.json'), JSON.stringify({ checkedAt: new Date().toISOString(), approvedMigration: checks.target, sha256: checks.expected, verifiedBackup: path.relative(root, backupDir), backupSha256: backup.sha256, appliedMigrationCount: applied.length, pending, tableData: before }, null, 2));
    console.log('Preflight PASS: fresh restored backup and rehearsal; prior checksums match; only qr-service migration pending.');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), PGOPTIONS: '-c lock_timeout=10000 -c statement_timeout=120000' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
      child.on('error', reject);
      child.on('close', code => { if (code === 0) resolve(); else { fs.writeFileSync(path.join(backupDir, 'migration-error.txt'), redact(output)); reject(Error('Prisma deploy failed; private diagnostic retained in backup directory')); } });
    });
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const installed = (await client.query('SELECT migration_name,checksum,finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY started_at')).rows;
    const record = installed.find(m => m.migration_name === checks.target);
    if (!record?.finished_at || record.checksum !== checks.expected) throw Error('Applied migration checksum/state failed');
    const result = await checks.verify(client, before, inventory);
    await client.query('ROLLBACK');
    const report = { verifiedAt: new Date().toISOString(), migration: checks.target, sha256: checks.expected, appliedMigrationCount: installed.length, verifiedBackup: path.relative(root, backupDir), backupSha256: backup.sha256, liveMigrationApplied: true, ...result };
    fs.writeFileSync(path.join(root, 'docs/migrations/qr-service-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ migration: checks.target, appliedMigrationCount: installed.length, allExistingBusinessDataPreserved: true, constraintsValidated: true, indexesValidated: true, liveMigrationApplied: true }));
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}
main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
