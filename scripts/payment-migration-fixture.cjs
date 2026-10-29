/* eslint-disable @typescript-eslint/no-require-imports -- Called only by the isolated localhost migration runner. */
const assert=require('node:assert/strict');
async function seed(client){
 await client.query(`INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ('legacy-org','Legacy','legacy-payment-fixture',now())`);
 await client.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('legacy-user','legacy@example.test',now())`);
 await client.query(`INSERT INTO "Branch" (id,name,"organizationId","updatedAt") VALUES ('legacy-branch','Legacy','legacy-org',now())`);
 await client.query(`INSERT INTO "FinanceCategory" (id,name,"organizationId",direction,"updatedAt") VALUES ('legacy-category','Legacy','legacy-org','OUT',now())`);
 await client.query(`INSERT INTO "FinanceAccount" (id,name,"organizationId","branchId",type,"updatedAt") VALUES ('legacy-account','Legacy','legacy-org','legacy-branch','CASH',now())`);
 await client.query(`INSERT INTO "CurrentAccount" (id,code,name,"organizationId",type,"updatedAt") VALUES ('legacy-card','LEGACY','Legacy','legacy-org','SUPPLIER',now())`);
 await client.query(`INSERT INTO "Expense" (id,title,"organizationId","branchId","categoryId",amount,"expenseDate","currentAccountId","idempotencyKey","requestHash","createdByUserId","updatedAt") VALUES ('legacy-expense','Legacy','legacy-org','legacy-branch','legacy-category',1000,now(),'legacy-card','legacy-expense','legacy','legacy-user',now())`);
 await client.query(`INSERT INTO "FinanceTransaction" (id,"organizationId","branchId","accountId",source,direction,amount,"updatedAt") VALUES ('legacy-movement','legacy-org','legacy-branch','legacy-account','EXPENSE_PAYMENT','OUT',300,now())`);
 await client.query(`INSERT INTO "CurrentAccountEntry" (id,"organizationId","branchId","currentAccountId","expenseId",kind,direction,amount,"financeTransactionId","createdByUserId","idempotencyKey","requestHash") VALUES ('legacy-entry','legacy-org','legacy-branch','legacy-card','legacy-expense','PAYMENT','DEBIT',300,'legacy-movement','legacy-user','legacy-entry','legacy')`);
 await client.query(`INSERT INTO "ExpensePayment" (id,"organizationId","branchId","expenseId",amount,"paidAt","financeTransactionId","currentAccountEntryId","createdByUserId","idempotencyKey","requestHash") VALUES ('legacy-payment','legacy-org','legacy-branch','legacy-expense',300,now(),'legacy-movement','legacy-entry','legacy-user','legacy-payment','legacy')`);
 return snapshot(client);
}
async function snapshot(client){const result={};for(const table of ['ExpensePayment','FinanceTransaction','CurrentAccountEntry','Expense'])result[table]=(await client.query(`SELECT to_jsonb(t) - (CASE WHEN '${table}'='ExpensePayment' THEN ARRAY['type','currentAccountId','cancelledAt','cancelledByUserId','cancelledByProfileId','cancellationReason','reversalFinanceTransactionId','reversalCurrentAccountEntryId'] ELSE ARRAY[]::text[] END) AS row FROM "${table}" t WHERE "organizationId"='legacy-org' ORDER BY id`)).rows;return result;}
async function verify(client,before){assert.deepEqual(await snapshot(client),before);const {rows:[p]}=await client.query(`SELECT * FROM "ExpensePayment" WHERE id='legacy-payment'`);assert.equal(p.type,'EXPENSE_PAYMENT');assert.equal(p.currentAccountId,'legacy-card');assert.equal(p.cancelledAt,null);console.log('Historical payment IDs, amounts, hashes and movements preserved; current account backfill verified.');}
module.exports={seed,verify};
