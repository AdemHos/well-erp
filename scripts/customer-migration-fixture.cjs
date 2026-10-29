/* eslint-disable @typescript-eslint/no-require-imports -- New isolated localhost database only, called by the local runner. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const quote = s => '"' + s.replaceAll('"','""') + '"';
async function snapshot(client) {
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','Customer') ORDER BY tablename")).rows;
  const result={};
  for(const {tablename} of tables){const expr=tablename==='Order'?`to_jsonb(t)-ARRAY['customerId','customerSnapshot']`:'to_jsonb(t)';result[tablename]=(await client.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5((${expr})::text),'' ORDER BY md5((${expr})::text)),'')) AS digest FROM ${quote(tablename)} t`)).rows[0];}
  return result;
}
async function seed(client){
  await client.query(`INSERT INTO "Order" (id,"orderNumber","organizationId","branchId","paymentMethod",subtotal,total,"updatedAt") VALUES ('legacy-customer-order','LEGACY-CUSTOMER-ORDER','legacy-org','legacy-branch','CASH',0,0,now())`);
  return snapshot(client);
}
async function verify(client,before){
  const after=await snapshot(client);assert.deepEqual(after,before);
  const {rows:[order]}=await client.query(`SELECT "customerId","customerSnapshot" FROM "Order" WHERE id='legacy-customer-order'`);assert.equal(order.customerId,null);assert.equal(order.customerSnapshot,null);
  assert.equal((await client.query('SELECT count(*)::text AS count FROM "Customer"')).rows[0].count,'0');
  const constraints=(await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('"Customer"'::regclass,'"Order"'::regclass) ORDER BY conname`)).rows;assert(constraints.every(c=>c.convalidated));assert(constraints.some(c=>c.conname==='Order_customer_snapshot'));
  const report={verifiedAt:new Date().toISOString(),environment:'new-isolated-localhost',allExistingBusinessDataPreserved:true,oldOrdersRemainUnassigned:true,noAutomaticCustomerBackfill:true,tableData:after,constraints};
  fs.writeFileSync(path.resolve(__dirname,'../docs/migrations/customers-local-verification.json'),JSON.stringify(report,null,2));
  console.log('Customer migration: all original business data preserved; old sales unassigned; no guessed customer backfill.');
}
module.exports={seed,verify};
