/* eslint-disable @typescript-eslint/no-require-imports -- Additive QR migration assertions, no implicit connections. */
const fs = require('node:fs'), path = require('node:path');
const base = require('./payment-deployment-checks.cjs');
const target = '20261024010000_add_qr_service_requests';
const expected = 'ac5be184f9ac2508e56e7f5bb214229a7c622ee5d68320c5601244218f3158ac';
const metadata = ['qrTokenHash', 'qrTokenRotatedAt', 'requestWindowStartedAt', 'requestWindowCount'];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function snapshot(client, inventory) {
  const result = {};
  for (const t of inventory) {
    if (t.tablename === '_prisma_migrations') continue;
    const expression = t.schemaname === 'public' && t.tablename === 'RestaurantTable' ? 'to_jsonb(t) - $1::text[]' : 'to_jsonb(t)';
    result[t.schemaname + '.' + t.tablename] = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5((${expression})::text), '' ORDER BY md5((${expression})::text)),'')) AS digest FROM ${quote(t.schemaname)}.${quote(t.tablename)} t`, expression.includes('$1') ? [metadata] : [])).rows[0];
  }
  return result;
}
async function verify(client, before, inventory) {
  const after = await snapshot(client, inventory);
  const differences = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (differences.length) throw Error('Existing business data changed: ' + differences.join(', '));
  for (const table of ['BranchQrMenu', 'ServiceRequest']) if ((await client.query(`SELECT count(*)::text AS n FROM ${quote(table)}`)).rows[0].n !== '0') throw Error('Unexpected QR backfill');
  if ((await client.query('SELECT count(*)::text AS n FROM "RestaurantTable" WHERE "qrTokenHash" IS NOT NULL OR "qrTokenRotatedAt" IS NOT NULL OR "requestWindowStartedAt" IS NOT NULL OR "requestWindowCount" <> 0')).rows[0].n !== '0') throw Error('Unexpected existing table token/counter changes');
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations', target, 'migration.sql'), 'utf8');
  if (base.hash(Buffer.from(sql)) !== expected) throw Error('Approved SQL checksum changed');
  const constraints = (await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('"BranchQrMenu"'::regclass,'"ServiceRequest"'::regclass,'"RestaurantTable"'::regclass) ORDER BY conname`)).rows;
  const requiredConstraints = ['BranchQrMenu_pkey', 'ServiceRequest_pkey', ...[...sql.matchAll(/CONSTRAINT "([^"]+)"/g)].map(m => m[1])];
  for (const name of requiredConstraints) if (!constraints.some(c => c.conname === name && c.convalidated)) throw Error('Missing/invalid constraint: ' + name);
  const indexes = (await client.query(`SELECT c.relname AS indexname,i.indisvalid,i.indisready,pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND i.indrelid IN ('"BranchQrMenu"'::regclass,'"ServiceRequest"'::regclass,'"RestaurantTable"'::regclass,'"Tab"'::regclass) ORDER BY c.relname`)).rows;
  for (const [, name] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)) if (!indexes.some(i => i.indexname === name && i.indisvalid && i.indisready)) throw Error('Missing/invalid index: ' + name);
  const partial = indexes.find(i => i.indexname === 'ServiceRequest_open_table_type_key');
  if (!partial?.predicate?.includes('PENDING') || !partial.predicate.includes('ACKNOWLEDGED')) throw Error('Open request partial index predicate missing');
  const sort = list => [...list].sort((a, b) => (a.schemaname + '.' + a.tablename).localeCompare(b.schemaname + '.' + b.tablename));
  if (JSON.stringify(sort(await base.tables(client))) !== JSON.stringify(sort([...inventory, { schemaname: 'public', tablename: 'BranchQrMenu' }, { schemaname: 'public', tablename: 'ServiceRequest' }]))) throw Error('Unexpected table inventory');
  return { allExistingBusinessDataPreserved: true, noAutomaticQrBackfill: true, tableData: after, constraints, indexes };
}
module.exports = { target, expected, hash: base.hash, tables: base.tables, snapshot, verify };
