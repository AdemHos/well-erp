/* eslint-disable @typescript-eslint/no-require-imports -- Real PostgreSQL endpoints; local isolated database only, rollback fixtures. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('PostgreSQL invoices: lifecycle, VAT, expense adoption/payments, numbering, isolation, reports and atomic rollback', { skip: process.env.WELLPOS_INVOICES_DB_TEST !== '1', timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL); assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname), 'Invoice integration tests only accept isolated localhost');
  require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }), load = Module._load, log = console.error, rollback = new Error('ROLLBACK_INVOICE_FIXTURES');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const seed = crypto.randomUUID(), org = await tx.organization.create({data:{name:'Şirket İğdır',slug:'invoice-'+seed}}), user = await tx.user.create({data:{email:seed+'@example.test',name:'Test'}});
      const branch = await tx.branch.create({data:{name:'Şube',organizationId:org.id}}), otherBranch = await tx.branch.create({data:{name:'Diğer',organizationId:org.id}});
      const supplier = await tx.currentAccount.create({data:{organizationId:org.id,code:'S1',name:'Tedarikçi',type:'SUPPLIER'}}), supplier2 = await tx.currentAccount.create({data:{organizationId:org.id,code:'S2',name:'Tedarikçi 2',type:'SUPPLIER'}}), customer = await tx.currentAccount.create({data:{organizationId:org.id,code:'C1',name:'Müşteri',type:'CUSTOMER'}});
      const category = await tx.financeCategory.create({data:{organizationId:org.id,name:'Elektrik',direction:'OUT'}}), cash = await tx.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:'Kasa',type:'CASH',openingBalance:100000}}), cashB = await tx.financeAccount.create({data:{organizationId:org.id,branchId:otherBranch.id,name:'Diğer kasa',type:'CASH',openingBalance:100000}});
      let actor = {userId:user.id,organizationId:org.id,role:'OWNER',allBranches:true,branchAccess:[]}, failAudit = false;
      const transaction = async work => { await tx.$executeRawUnsafe('SAVEPOINT invoice_api'); try { const guarded = new Proxy(tx,{get(target,key){if(key==='auditLog'&&failAudit)return new Proxy(target.auditLog,{get(delegate,k){return k==='create'?async()=>{throw Error('Injected audit failure')}:Reflect.get(delegate,k,delegate)}});return Reflect.get(target,key,target)}});const value = await work(guarded);await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_api');return value;}catch(e){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invoice_api');await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_api');throw e;} };
      const client = new Proxy(tx,{get(target,key){return key==='$transaction'?transaction:Reflect.get(target,key,target)}});
      Module._load = function(request,parent,main){if(request==='@/lib/prisma')return {prisma:client};if(request==='@/lib/current-membership')return {getCurrentMembership:async()=>actor};if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));return load.call(this,request,parent,main)};
      const root=require('../src/app/api/invoices/route.ts'), detail=require('../src/app/api/invoices/[id]/route.ts'), issue=require('../src/app/api/invoices/[id]/issue/route.ts'), cancel=require('../src/app/api/invoices/[id]/cancel/route.ts'), pdf=require('../src/app/api/invoices/[id]/pdf/route.ts');
      const calculate=require('../src/app/api/invoices/calculate/route.ts'), statement=require('../src/app/api/current-accounts/[id]/entries/route.ts'), options=require('../src/app/api/invoices/options/route.ts');
      const expenses=require('../src/app/api/expenses/route.ts'), expenseDetail=require('../src/app/api/expenses/[id]/route.ts'), payments=require('../src/app/api/expenses/[id]/payments/route.ts'), expenseCancel=require('../src/app/api/expenses/[id]/cancel/route.ts'); Module._load=load;
      const req=(method,url,body)=>new NextRequest('http://localhost'+url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}), ctx=id=>({params:Promise.resolve({id})});
      const expect=async(response,status)=>{assert.equal(response.status,status,await response.clone().text());return response.json()};
      const item={description:'Elektrik hizmeti İıŞşĞğÇçÖöÜü',unit:'Adet',quantity:'1',unitPrice:'10000',vatRate:'0'};
      const body=(changes={})=>({type:'PURCHASE',number:crypto.randomUUID(),invoiceDate:'2026-01-01',dueDate:'2026-01-15',branchId:branch.id,currentAccountId:supplier.id,priceMode:'TAX_EXCLUSIVE',items:[item],idempotencyKey:crypto.randomUUID(),...changes});
      const create=async changes=>(await expect(await root.POST(req('POST','/api/invoices',body(changes))),201)).invoice;
      const get=async id=>(await expect(await detail.GET(req('GET','/api/invoices/'+id),ctx(id)),200)).invoice;
      const issueIt=async i=>expect(await issue.POST(req('POST','/api/invoices/'+i.id+'/issue',{expectedVersion:i.version}),ctx(i.id)),200);
      const cancelIt=async i=>cancel.POST(req('POST','/api/invoices/'+i.id+'/cancel',{expectedVersion:i.version,reason:'Hatalı ticari belge'}),ctx(i.id));
      const counts=async()=>Promise.all([tx.financeTransaction.count({where:{organizationId:org.id}}),tx.currentAccountEntry.count({where:{organizationId:org.id}}),tx.stockMovement.count({where:{organizationId:org.id}})]);
      const calculationBody=body();delete calculationBody.idempotencyKey;const calculation=await expect(await calculate.POST(req('POST','/api/invoices/calculate',calculationBody)),200);assert.equal(calculation.calculation.grandTotal,'10000');assert.deepEqual(await counts(),[0,0,0]);
      const editableBody=body(), editable=(await expect(await root.POST(req('POST','/api/invoices',editableBody)),201)).invoice;
      const editBody={...editableBody};delete editBody.idempotencyKey;
      await expect(await detail.PATCH(req('PATCH','/api/invoices/'+editable.id,{...editBody,expectedVersion:1,discountType:'PERCENT',discountValue:'10',items:[{...item,quantity:'2',unitPrice:'100',vatRate:'20',discountType:'PERCENT',discountValue:'10'},{...item,unitPrice:'50',vatRate:'10'}]}),ctx(editable.id)),200);
      const edited=await get(editable.id);assert.equal(edited.items.length,2);assert.equal(edited.grandTotal,'243.9');assert.equal(edited.version,2);assert.deepEqual(await counts(),[0,0,0]);
      await expect(await detail.PATCH(req('PATCH','/api/invoices/'+editable.id,{...editBody,expectedVersion:1}),ctx(editable.id)),409);
      const opts=await expect(await options.GET(req('GET','/api/invoices/options')),200);assert.equal(opts.branches.length,2);assert(opts.accounts.some(a=>a.id===supplier.id));
      const draft=await create(); assert.equal(draft.status,'DRAFT'); assert.deepEqual(await counts(),[0,0,0]);
      await issueIt(draft);let purchase=await get(draft.id);assert.equal(purchase.status,'ISSUED');assert.equal(purchase.remainingAmount,'10000');assert.deepEqual(await counts(),[0,1,0]);
      assert.equal((await tx.currentAccountEntry.findUnique({where:{id:purchase.accrualEntryId}})).direction,'CREDIT');
      await expect(await issue.POST(req('POST','/api/invoices/'+draft.id+'/issue',{expectedVersion:1}),ctx(draft.id)),409);assert.deepEqual(await counts(),[0,1,0]);
      await expect(await detail.PATCH(req('PATCH','/api/invoices/'+draft.id,{expectedVersion:purchase.version}),ctx(draft.id)),409);
      await expect(await cancelIt(purchase),200);purchase=await get(draft.id);const reverse=await tx.currentAccountEntry.findUnique({where:{id:purchase.reversalEntryId}});assert.equal(reverse.direction,'DEBIT');assert.equal(reverse.reversalOfId,purchase.accrualEntryId);
      await expect(await cancelIt(purchase),200);assert.deepEqual(await counts(),[0,2,0]);
      const sales=await create({type:'SALES',currentAccountId:customer.id});await issueIt(sales);const saleEntry=await tx.currentAccountEntry.findFirstOrThrow({where:{sourceKey:`invoice:${sales.id}:accrual`}});assert.equal(saleEntry.direction,'DEBIT');
      await expect(await root.POST(req('POST','/api/invoices',body({type:'SALES'}))),404);
      // Real unique indexes: supplier external reference differs by supplier, sales reference spans branches.
      const numbered=body({number:' EXTERNAL-1 '});await expect(await root.POST(req('POST','/api/invoices',numbered)),201);await expect(await root.POST(req('POST','/api/invoices',numbered)),200);
      await expect(await root.POST(req('POST','/api/invoices',body({number:'external-1'}))),409);await create({number:'external-1',currentAccountId:supplier2.id});
      await create({number:'OWN-1',type:'SALES',currentAccountId:customer.id});await expect(await root.POST(req('POST','/api/invoices',body({number:'own-1',type:'SALES',currentAccountId:supplier2.id,branchId:otherBranch.id}))),404);
      await expect(await root.POST(req('POST','/api/invoices',body({number:'OWN-1',type:'SALES',currentAccountId:customer.id,branchId:otherBranch.id}))),409);
      for(const spoof of [{orderId:'fake'},{paymentStatus:'PAID'},{grandTotal:'1'},{currency:'USD'}])await expect(await root.POST(req('POST','/api/invoices',body(spoof))),400);
      // One expense liability; adopting and allocating existing payments never writes a second cash/current movement.
      const expenseBody={title:'Elektrik',categoryId:category.id,amount:'10000',branchId:branch.id,currentAccountId:supplier.id,expenseDate:'2026-01-01',idempotencyKey:crypto.randomUUID()};
      const expense=(await expect(await expenses.POST(req('POST','/api/expenses',expenseBody)),201)).expense;
      const payBody={accountId:cash.id,amount:'3000',idempotencyKey:crypto.randomUUID()};
      await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',payBody),ctx(expense.id)),201);
      const linked=await create({expenseId:expense.id}), before=await counts();await issueIt(linked);assert.deepEqual(await counts(),before);let linkedDetail=await get(linked.id);assert.equal(linkedDetail.paymentStatus,'PARTIALLY_PAID');assert.equal(linkedDetail.remainingAmount,'7000');assert.equal(linkedDetail.allocations.length,1);
      await expect(await cancelIt(linkedDetail),409);
      await expect(await expenseDetail.PATCH(req('PATCH','/api/expenses/'+expense.id,{expectedVersion:2,title:'Changed'}),ctx(expense.id)),409);
      await expect(await expenseCancel.POST(req('POST','/api/expenses/'+expense.id+'/cancel',{expectedVersion:2,reason:'No'}),ctx(expense.id)),409);
      await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',{...payBody,idempotencyKey:crypto.randomUUID(),accountId:cashB.id}),ctx(expense.id)),409);
      const finalPay={...payBody,amount:'7000',idempotencyKey:crypto.randomUUID()};const beforeFailedPayment=await counts();failAudit=true;console.error=()=>{};try{await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',finalPay),ctx(expense.id)),500);}finally{failAudit=false;console.error=log;}assert.deepEqual(await counts(),beforeFailedPayment);assert.equal((await get(linked.id)).allocations.length,1);await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',finalPay),ctx(expense.id)),201);await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',finalPay),ctx(expense.id)),200);
      linkedDetail=await get(linked.id);assert.equal(linkedDetail.paymentStatus,'PAID');assert.equal(linkedDetail.allocations.length,2);assert.equal(linkedDetail.remainingAmount,'0');await expect(await payments.POST(req('POST','/api/expenses/'+expense.id+'/payments',{...payBody,amount:'0.01',idempotencyKey:crypto.randomUUID()}),ctx(expense.id)),409);
      const expenseReport=await expect(await expenses.GET(req('GET','/api/expenses')),200);assert.equal(expenseReport.summary.totalAmount,'10000.00');assert.equal(expenseReport.summary.paidAmount,'10000.00');
      const ledger=await expect(await statement.GET(req('GET','/api/current-accounts/'+supplier.id+'/entries?q='+encodeURIComponent(linked.number)),ctx(supplier.id)),200);assert.equal(ledger.entries.length,3);assert(ledger.entries.every(e=>e.invoiceId===linked.id));assert.equal(ledger.summary.balance,'0.00');
      const report=await expect(await root.GET(req('GET','/api/invoices?status=ISSUED&limit=1')),200);assert.equal(report.summary.purchaseTotal,'10000.00');assert.equal(report.summary.salesTotal,'10000.00');assert.equal(report.summary.payable,'0.00');assert.equal(report.summary.receivable,'10000.00');assert.equal(report.pagination.total,2);
      // New linked expense and cancellation reverse the single liability together.
      const tracked=await create({expenseCategoryId:category.id});await issueIt(tracked);const trackedDetail=await get(tracked.id);assert(trackedDetail.expenseId);await expect(await cancelIt(trackedDetail),200);assert((await tx.expense.findUnique({where:{id:trackedDetail.expenseId}})).cancelledAt);
      const empty=await create({items:[{...item,unitPrice:'0'}]});await expect(await issue.POST(req('POST','/api/invoices/'+empty.id+'/issue',{expectedVersion:1}),ctx(empty.id)),409);
      // Every leg including audit must roll back on failure.
      const atomic=await create(), atomicBefore=await counts();failAudit=true;console.error=()=>{};try{await expect(await issue.POST(req('POST','/api/invoices/'+atomic.id+'/issue',{expectedVersion:1}),ctx(atomic.id)),500);}finally{failAudit=false;console.error=log;}assert.deepEqual(await counts(),atomicBefore);assert.equal((await get(atomic.id)).status,'DRAFT');
      // Future POS link is unique and tenant/branch constrained; there is no public conversion endpoint.
      const pos=await tx.order.create({ omit: { customerId: true, customerSnapshot: true },data:{organizationId:org.id,branchId:branch.id,orderNumber:'POS-FIXTURE',paymentMethod:'CASH',subtotal:10,total:10}});
      const posDraft=await create(), duplicateDraft=await create();await tx.invoice.update({where:{id:posDraft.id},data:{orderId:pos.id}});
      await assert.rejects(transaction(t=>t.invoice.update({where:{id:duplicateDraft.id},data:{orderId:pos.id}})),e=>e.code==='P2002');
      const otherPos=await tx.order.create({ omit: { customerId: true, customerSnapshot: true },data:{organizationId:org.id,branchId:otherBranch.id,orderNumber:'POS-OTHER-BRANCH',paymentMethod:'CASH',subtotal:10,total:10}});
      await assert.rejects(transaction(t=>t.invoice.update({where:{id:duplicateDraft.id},data:{orderId:otherPos.id}})),e=>e.code==='P2003');
      await expect(await issue.POST(req('POST','/api/invoices/'+posDraft.id+'/issue',{expectedVersion:1}),ctx(posDraft.id)),409);
      // Download is a real PDF, guarded by same API authorization and branch scope.
      const pdfResponse=await pdf.GET(req('GET',`/api/invoices/${sales.id}/pdf`),ctx(sales.id));assert.equal(pdfResponse.status,200);assert.equal(pdfResponse.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
      actor={...actor,role:'CASHIER'};await expect(await root.POST(req('POST','/api/invoices',body())),403);assert.equal((await pdf.GET(req('GET','/api/invoices/'+sales.id+'/pdf'),ctx(sales.id))).status,403);
      actor={...actor,role:'MANAGER',allBranches:false,branchAccess:[{branchId:otherBranch.id}]};await expect(await detail.GET(req('GET','/api/invoices/'+sales.id),ctx(sales.id)),404);await expect(await root.GET(req('GET','/api/invoices?branchId='+branch.id)),404);
      const foreign=await tx.organization.create({data:{name:'Foreign',slug:'foreign-'+seed}});actor={...actor,role:'OWNER',organizationId:foreign.id,allBranches:true};await expect(await detail.GET(req('GET','/api/invoices/'+sales.id),ctx(sales.id)),404);assert.equal((await pdf.GET(req('GET','/api/invoices/'+sales.id+'/pdf'),ctx(sales.id))).status,404);
      assert.equal(await tx.stockMovement.count({where:{organizationId:org.id}}),0);assert.equal(await tx.financeTransaction.count({where:{organizationId:org.id,source:'POS_SALE'}}),0);
      throw rollback;
    },{timeout:110000,isolationLevel:'Serializable'}),e=>e===rollback);
  } finally {Module._load=load;console.error=log;await db.$disconnect();}
});
