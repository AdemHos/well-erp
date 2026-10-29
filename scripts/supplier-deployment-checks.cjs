/* eslint-disable @typescript-eslint/no-require-imports -- Additive supplier migration checks; no implicit connections. */
const base = require('./payment-deployment-checks.cjs');
const target = '20261023030000_add_suppliers';
const expected = '92d2972c040b4ba22ae699b8583e775f025935ff4fad70cca833632e2156454e';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function snapshot(client, inventory) {
  const result = {};
  for (const t of inventory) {
    if (t.tablename === '_prisma_migrations') continue;
    result[t.schemaname + '.' + t.tablename] = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${quote(t.schemaname)}.${quote(t.tablename)} t`)).rows[0];
  }
  return result;
}
async function verify(client, before, inventory) {
  const after = await snapshot(client, inventory);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Existing business data changed');
  for (const table of ['Supplier','SupplierProduct']) if ((await client.query(`SELECT count(*)::text AS n FROM ${quote(table)}`)).rows[0].n !== '0') throw Error('Unexpected supplier backfill');
  const constraints = (await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('"Supplier"'::regclass,'"SupplierProduct"'::regclass) ORDER BY conname`)).rows;
  for (const name of ['Supplier_pkey','Supplier_organizationId_fkey','Supplier_currentAccountId_organizationId_fkey','Supplier_createdByUserId_fkey','Supplier_createdByProfileId_organizationId_fkey','Supplier_normalized_code','Supplier_name_nonempty','Supplier_version_positive','Supplier_tax_number','SupplierProduct_organizationId_fkey','SupplierProduct_supplierId_organizationId_fkey','SupplierProduct_productId_organizationId_fkey','SupplierProduct_price_nonnegative','SupplierProduct_version_positive']) {
    if (!constraints.some(c => c.conname === name && c.convalidated)) throw Error('Missing/invalid constraint: ' + name);
  }
  const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Supplier','SupplierProduct') ORDER BY indexname`)).rows;
  for (const name of ['Supplier_currentAccountId_key','Supplier_currentAccountId_organizationId_key','Supplier_id_organizationId_key','Supplier_organizationId_code_key','Supplier_organizationId_idempotencyKey_key','Supplier_organizationId_isActive_idx','Supplier_organizationId_name_id_idx','SupplierProduct_organizationId_productId_idx','SupplierProduct_organizationId_supplierId_productId_key']) if (!indexes.some(i => i.indexname === name)) throw Error('Missing index: ' + name);
  const sort = list => [...list].sort((a,b)=>(a.schemaname+'.'+a.tablename).localeCompare(b.schemaname+'.'+b.tablename));
  if (JSON.stringify(sort(await base.tables(client))) !== JSON.stringify(sort([...inventory, {schemaname:'public',tablename:'Supplier'}, {schemaname:'public',tablename:'SupplierProduct'}]))) throw Error('Unexpected table inventory');
  return { allExistingBusinessDataPreserved: true, noAutomaticSupplierBackfill: true, tableData: after, constraints, indexes };
}
module.exports = { target, expected, hash: base.hash, tables: base.tables, snapshot, verify };
