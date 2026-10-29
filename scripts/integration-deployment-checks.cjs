/* eslint-disable @typescript-eslint/no-require-imports -- Approved additive printer migration verification. */
const fs = require('node:fs'), path = require('node:path');
const base = require('./payment-deployment-checks.cjs');
const target = '20261027010000_add_branch_printer_settings', expected = '0176988bd3421265569d10322d650c8708090551da11705f4f9aae0111fcba51';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function snapshot(client, inventory) {
  const result = {};
  for (const t of inventory) {
    if (t.tablename === '_prisma_migrations') continue;
    const table = quote(t.schemaname) + '.' + quote(t.tablename);
    result[t.schemaname + '.' + t.tablename] = (await client.query("SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM " + table + ' t')).rows[0];
  }
  return result;
}
async function verify(client, before, inventory) {
  const after = await snapshot(client, inventory);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Existing business data changed');
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations', target, 'migration.sql'), 'utf8');
  if (base.hash(Buffer.from(sql)) !== expected) throw Error('Approved SQL checksum changed');
  if ((await client.query('SELECT count(*)::text AS n FROM "BranchPrinterSetting"')).rows[0].n !== '0') throw Error('Unexpected printer backfill');
  const constraints = (await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid='"BranchPrinterSetting"'::regclass ORDER BY conname`)).rows;
  for (const [, name] of sql.matchAll(/CONSTRAINT "([^"]+)"/g)) if (!constraints.some(c => c.conname === name && c.convalidated)) throw Error('Missing constraint: ' + name);
  const indexes = (await client.query(`SELECT c.relname AS indexname,i.indisvalid,i.indisready FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='"BranchPrinterSetting"'::regclass ORDER BY c.relname`)).rows;
  for (const [, name] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)) if (!indexes.some(i => i.indexname === name && i.indisvalid && i.indisready)) throw Error('Missing index: ' + name);
  const sort = list => [...list].sort((a,b) => (a.schemaname+'.'+a.tablename).localeCompare(b.schemaname+'.'+b.tablename));
  if (JSON.stringify(sort(await base.tables(client))) !== JSON.stringify(sort([...inventory, {schemaname:'public',tablename:'BranchPrinterSetting'}]))) throw Error('Unexpected table inventory');
  return {allExistingBusinessDataPreserved:true, noAutomaticPrinterBackfill:true, tableData:after, constraints,indexes};
}
module.exports = {target,expected,hash:base.hash,tables:base.tables,snapshot,verify};
