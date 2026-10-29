/* eslint-disable @typescript-eslint/no-require-imports -- Aggregate-only audit, enforced READ ONLY at PostgreSQL session and transaction level. */
const { Client } = require('pg');
const fs = require('node:fs'), path = require('node:path');
require('dotenv').config({ quiet: true });
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith('.neon.tech')) throw new Error('Expected configured Neon source');
  const client = new Client({ connectionString: url.href, application_name: 'wellpos-mvp-readonly' });
  try {
    await client.connect();
    // Neon poolers reject startup options; enforce the same policy before any data query.
    await client.query('SET default_transaction_read_only=on');
    await client.query('SET statement_timeout=20000');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const mode = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
    if (mode !== 'on') throw new Error('Read-only enforcement absent');
    const queries = {
      restaurantSalesMissingFinance: `SELECT count(*)::text AS count FROM "Tab" t JOIN "Order" o ON o.id=t."orderId" WHERE o.total>0 AND o.status::text IN ('COMPLETED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM "FinanceTransaction" f WHERE f."orderId"=o.id AND f.source::text='POS_SALE')`,
      allSalesMissingFinance: `SELECT count(*)::text AS count FROM "Order" o WHERE o.total>0 AND o.status::text IN ('COMPLETED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM "FinanceTransaction" f WHERE f."orderId"=o.id AND f.source::text='POS_SALE')`,
      invalidSalesFinance: `SELECT count(*)::text AS count FROM "FinanceTransaction" f JOIN "Order" o ON o.id=f."orderId" WHERE f.source::text='POS_SALE' AND (f.amount<>o.total OR f.direction::text<>'IN' OR f."organizationId"<>o."organizationId" OR f."branchId"<>o."branchId")`,
      refundedSalesMissingReversal: `SELECT count(*)::text AS count FROM "Order" o WHERE o.status::text='REFUNDED' AND o.total>0 AND NOT EXISTS (SELECT 1 FROM "FinanceTransaction" f WHERE f."orderId"=o.id AND f.source::text='POS_REFUND')`,
      duplicateOpenTabs: `SELECT count(*)::text AS count FROM (SELECT "tableId" FROM "Tab" WHERE status::text='OPEN' GROUP BY "tableId" HAVING count(*)>1) d`,
      duplicateBranchNames: `SELECT count(*)::text AS count FROM (SELECT "organizationId",lower(btrim(name)) FROM "Branch" GROUP BY 1,2 HAVING count(*)>1) d`,
      stockTenantMismatch: `SELECT count(*)::text AS count FROM "BranchStock" s JOIN "Branch" b ON b.id=s."branchId" JOIN "Product" p ON p.id=s."productId" WHERE s."organizationId"<>b."organizationId" OR s."organizationId"<>p."organizationId"`,
      financeTenantMismatch: `SELECT count(*)::text AS count FROM "FinanceTransaction" f JOIN "FinanceAccount" a ON a.id=f."accountId" WHERE f."organizationId"<>a."organizationId" OR f."branchId"<>a."branchId"`,
      negativeStockRows: `SELECT count(*)::text AS count FROM "BranchStock" WHERE quantity<0`,
      hardeningConstraintCount: `SELECT count(*)::text AS count FROM pg_constraint WHERE conname IN ('BranchStock_productId_organizationId_fkey','FinanceTransaction_accountId_organizationId_branchId_fkey')`,
    };
    const counts = {};
    for (const [name, sql] of Object.entries(queries)) counts[name] = Number((await client.query(sql)).rows[0].count);
    await client.query('ROLLBACK');
    const report = { verifiedAt: new Date().toISOString(), readOnly: true, aggregateOnly: true, counts };
    fs.mkdirSync(path.join(__dirname, '../docs/acceptance'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../docs/acceptance/live-readonly.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await client.end(); }
}
main().catch(error => { console.error('Read-only check failed:', error.code || error.name); process.exitCode = 1; });
