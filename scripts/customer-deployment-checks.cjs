/* eslint-disable @typescript-eslint/no-require-imports -- Shared customer migration assertions; no implicit connections. */
const base = require('./payment-deployment-checks.cjs');
const target = '20261023020000_add_customers';
const expected = '9bf264c4bdf6ff689273878642d6a634929f64ae5451ddaed7868998a7e6b2c8';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function snapshot(client, inventory) {
  const result = {};
  for (const t of inventory) {
    if (t.tablename === '_prisma_migrations') continue;
    const expression = t.schemaname === 'public' && t.tablename === 'Order' ? "to_jsonb(t)-ARRAY['customerId','customerSnapshot']" : 'to_jsonb(t)';
    result[t.schemaname + '.' + t.tablename] = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5((${expression})::text), '' ORDER BY md5((${expression})::text)),'')) AS digest FROM ${quote(t.schemaname)}.${quote(t.tablename)} t`)).rows[0];
  }
  return result;
}
async function verify(client, before, inventory) {
  const after = await snapshot(client, inventory);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Existing business data changed');
  if ((await client.query('SELECT count(*)::text AS n FROM "Customer"')).rows[0].n !== '0') throw Error('Unexpected customer backfill');
  if ((await client.query('SELECT count(*)::text AS n FROM "Order" WHERE "customerId" IS NOT NULL OR "customerSnapshot" IS NOT NULL')).rows[0].n !== '0') throw Error('Historical orders were assigned');
  const constraints = (await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('"Customer"'::regclass,'"Order"'::regclass) ORDER BY conname`)).rows;
  for (const name of ['Customer_pkey','Customer_organizationId_fkey','Customer_currentAccountId_organizationId_fkey','Customer_createdByUserId_fkey','Customer_createdByProfileId_organizationId_fkey','Customer_normalized_code','Customer_name_nonempty','Customer_version_positive','Customer_tax_fields','Order_customerId_organizationId_fkey','Order_customer_snapshot']) {
    if (!constraints.some(c => c.conname === name && c.convalidated)) throw Error('Missing/invalid constraint: ' + name);
  }
  const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Customer','Order') ORDER BY indexname`)).rows;
  for (const name of ['Customer_currentAccountId_key','Customer_currentAccountId_organizationId_key','Customer_id_organizationId_key','Customer_organizationId_code_key','Customer_organizationId_idempotencyKey_key','Customer_organizationId_isActive_type_idx','Customer_organizationId_name_id_idx','Order_organizationId_customerId_createdAt_idx','Order_organizationId_customerId_branchId_createdAt_idx']) {
    if (!indexes.some(i => i.indexname === name)) throw Error('Missing index: ' + name);
  }
  const actual = await base.tables(client);
  const expectedTables = [...inventory, {schemaname:'public',tablename:'Customer'}].sort((a,b)=>(a.schemaname+'.'+a.tablename).localeCompare(b.schemaname+'.'+b.tablename));
  if (JSON.stringify([...actual].sort((a,b)=>(a.schemaname+'.'+a.tablename).localeCompare(b.schemaname+'.'+b.tablename))) !== JSON.stringify(expectedTables)) throw Error('Unexpected table inventory');
  return {allExistingBusinessDataPreserved:true,oldOrdersRemainUnassigned:true,noAutomaticCustomerBackfill:true,tableData:after,constraints,indexes};
}
module.exports = {target,expected,hash:base.hash,tables:base.tables,snapshot,verify};
