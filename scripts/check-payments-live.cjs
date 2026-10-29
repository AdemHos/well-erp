/* eslint-disable @typescript-eslint/no-require-imports -- Read-only post-migration application-client smoke check. */
const fs = require('node:fs'), ts = require('typescript');
require('dotenv').config({ quiet: true });
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { PrismaClient } = require('../src/generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith('.neon.tech')) throw Error('Expected configured Neon source');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const payments = await tx.payment.findMany({ take: 10, include: { currentAccount: true, financeTransaction: { include: { account: true } }, currentAccountEntry: true, allocations: { include: { invoice: true } }, cancelledBy: true, cancelledByProfile: true, reversalFinanceTransaction: true, reversalCurrentAccountEntry: true } });
      const paymentCount = await tx.payment.count();
      const [integrity] = await tx.$queryRaw`
        SELECT
          (SELECT COUNT(*)::text FROM "Invoice" i WHERE COALESCE((SELECT SUM(a.amount) FROM "InvoicePaymentAllocation" a JOIN "ExpensePayment" p ON p.id=a."paymentId" WHERE a."invoiceId"=i.id AND p."cancelledAt" IS NULL),0)>i."grandTotal") AS "overpaidInvoices",
          (SELECT COUNT(*)::text FROM "Expense" e WHERE COALESCE((SELECT SUM(p.amount) FROM "ExpensePayment" p WHERE p."expenseId"=e.id AND p."cancelledAt" IS NULL),0)>e.amount) AS "overpaidExpenses",
          (SELECT COUNT(*)::text FROM "ExpensePayment" p JOIN "FinanceTransaction" f ON f.id=p."financeTransactionId" WHERE p.amount<>f.amount OR p."organizationId"<>f."organizationId" OR p."branchId"<>f."branchId" OR f.direction::text<>(CASE WHEN p.type::text IN ('CUSTOMER_COLLECTION','SALES_INVOICE_COLLECTION') THEN 'IN' ELSE 'OUT' END)) AS "inconsistentFinanceLinks",
          (SELECT COUNT(*)::text FROM "ExpensePayment" p JOIN "CurrentAccountEntry" c ON c.id=p."currentAccountEntryId" WHERE p.amount<>c.amount OR p."currentAccountId" IS DISTINCT FROM c."currentAccountId" OR p."financeTransactionId" IS DISTINCT FROM c."financeTransactionId") AS "inconsistentCurrentLinks"
      `;
      if (Object.values(integrity).some(n => n !== '0')) throw Error('Read-only payment integrity checks failed');
      return { applicationClientRelations: 'PASS', readOnly: true, sampledPaymentCount: payments.length, paymentCount, integrity };
    }, { isolationLevel: 'RepeatableRead', timeout: 20000 });
    fs.writeFileSync(require('node:path').join(__dirname, '../docs/migrations/payments-live-readonly.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), ...result }, null, 2));
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error('Read-only payment smoke check failed:', error.code || error.name); process.exitCode = 1; });
