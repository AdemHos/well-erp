/* eslint-disable @typescript-eslint/no-require-imports -- Shared deployment/rehearsal assertions, no implicit database connections. */
const crypto = require('node:crypto');
const target = '20261023010000_add_payments';
const expected = 'aed4a6426837b5ad595c73ad57fc841e8996ba97f215711bab9a45d306e81522';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const metadata = ['type','currentAccountId','cancelledAt','cancelledByUserId','cancelledByProfileId','cancellationReason','reversalFinanceTransactionId','reversalCurrentAccountEntryId'];
async function tables(client) {
  return (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname,tablename")).rows;
}
async function snapshot(client, inventory) {
  const result = {};
  for (const t of inventory) {
    if (t.tablename === '_prisma_migrations') continue;
    const expression = t.schemaname === 'public' && t.tablename === 'ExpensePayment' ? 'to_jsonb(t) - $1::text[]' : 'to_jsonb(t)';
    result[t.schemaname + '.' + t.tablename] = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(md5((${expression})::text), '' ORDER BY md5((${expression})::text)),'')) AS digest FROM ${quote(t.schemaname)}.${quote(t.tablename)} t`, expression.includes('$1') ? [metadata] : [])).rows[0];
  }
  return result;
}
async function verify(client, before, inventory) {
  const after = await snapshot(client, inventory);
  const differences = Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
  if (differences.length) throw Error('Existing business data differs: ' + differences.join(', '));
  const constraints = (await client.query(`SELECT conname,convalidated FROM pg_constraint WHERE conrelid='"ExpensePayment"'::regclass ORDER BY conname`)).rows;
  const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='ExpensePayment' ORDER BY indexname`)).rows;
  for (const name of ['Payment_cancellation_complete','Payment_current_link','Payment_type_document','ExpensePayment_currentAccountId_organizationId_fkey','ExpensePayment_cancelledByUserId_fkey','ExpensePayment_cancelledByProfileId_organizationId_fkey','ExpensePayment_reversalFinanceTransactionId_organizationId_fkey','ExpensePayment_reversalCurrentAccountEntryId_organizationI_fkey']) {
    if (!constraints.some(c => c.conname === name && c.convalidated)) throw Error('Missing/invalid payment constraint: ' + name);
  }
  for (const name of ['ExpensePayment_reversalFinanceTransactionId_key','ExpensePayment_reversalCurrentAccountEntryId_key','ExpensePayment_organizationId_branchId_paidAt_idx','ExpensePayment_organizationId_type_cancelledAt_idx','ExpensePayment_organizationId_currentAccountId_paidAt_idx']) {
    if (!indexes.some(i => i.indexname === name)) throw Error('Missing payment index: ' + name);
  }
  const { rows: [links] } = await client.query(`SELECT count(*)::text AS count FROM "ExpensePayment" p LEFT JOIN "Expense" e ON e.id=p."expenseId" AND e."organizationId"=p."organizationId" AND e."branchId"=p."branchId" WHERE p.type::text<>'EXPENSE_PAYMENT' OR p."currentAccountId" IS DISTINCT FROM e."currentAccountId" OR p."cancelledAt" IS NOT NULL`);
  if (links.count !== '0') throw Error('Historical payment metadata validation failed');
  const enums = (await client.query(`SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN ('PaymentType','FinanceSource') ORDER BY t.typname,e.enumsortorder`)).rows;
  for (const value of ['CUSTOMER_COLLECTION','SUPPLIER_PAYMENT','EXPENSE_PAYMENT','PURCHASE_INVOICE_PAYMENT','SALES_INVOICE_COLLECTION']) if (!enums.some(e => e.typname === 'PaymentType' && e.enumlabel === value)) throw Error('Missing payment enum: ' + value);
  for (const value of ['PAYMENT','PAYMENT_REVERSAL']) if (!enums.some(e => e.typname === 'FinanceSource' && e.enumlabel === value)) throw Error('Missing finance source: ' + value);
  return { allExistingBusinessDataPreserved: true, tableData: after, historicalPaymentMetadataValid: true, constraints, indexes, enums };
}
module.exports = { target, expected, hash, tables, snapshot, verify };
