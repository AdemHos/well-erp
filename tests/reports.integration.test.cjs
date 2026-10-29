/* eslint-disable @typescript-eslint/no-require-imports -- Real localhost-only reporting integration; never connects to Neon. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('reports: requested 16 scenarios, all queries, export safety and read-only snapshots', { skip: process.env.WELLPOS_REPORTS_DB_TEST !== '1', timeout: 240000 }, async t => {
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Reporting fixtures must never reach Neon');
  for (const ext of ['.ts','.tsx']) require.extensions[ext] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(f).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
  const { PrismaClient, Prisma } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}), load = Module._load;
  let actor, activeBranch;
  try {
    const seed=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
    const org=await db.organization.create({data:{name:'Reports fixture',slug:'reports-'+seed}}), foreignOrg=await db.organization.create({data:{name:'Foreign reports fixture',slug:'foreign-reports-'+seed}}), user=await db.user.create({data:{email:seed+'@example.test'}});
    const branch=await db.branch.create({data:{organizationId:org.id,name:'A'}}), b=await db.branch.create({data:{organizationId:org.id,name:'B'}}), foreignBranch=await db.branch.create({data:{organizationId:foreignOrg.id,name:'Foreign'}});
    const cash=await db.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:'Cash',type:'CASH',openingBalance:10000}}), card=await db.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:'Card',type:'CARD'}}), bank=await db.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:'Bank',type:'BANK'}});
    const category=await db.financeCategory.create({data:{organizationId:org.id,name:'Rent',direction:'OUT'}});
    const product=await db.product.create({data:{organizationId:org.id,name:'=HYPERLINK("https://example.test")',price:1000,costPrice:200}}), raw=await db.product.create({data:{organizationId:org.id,name:'Flour',price:0,isSellable:false}});
    const supplierCard=await db.currentAccount.create({data:{organizationId:org.id,name:'Supplier',code:'S-'+seed,type:'SUPPLIER'}}), customerCard=await db.currentAccount.create({data:{organizationId:org.id,name:'Customer',code:'C-'+seed,type:'CUSTOMER'}});
    const supplier=await db.supplier.create({data:{organizationId:org.id,name:'Supplier',code:'S-'+seed,currentAccountId:supplierCard.id,createdByUserId:user.id,idempotencyKey:crypto.randomUUID(),requestHash:'fixture'}}), customer=await db.customer.create({data:{organizationId:org.id,name:'Customer',code:'C-'+seed,type:'INDIVIDUAL',currentAccountId:customerCard.id,createdByUserId:user.id,idempotencyKey:crypto.randomUUID(),requestHash:'fixture'}});
    actor={userId:user.id,organizationId:org.id,role:'OWNER',allBranches:true,branchAccess:[]};activeBranch=branch.id;
    Module._load=function(request,parent,main){if(request==='@/lib/prisma')return {prisma:db};if(request==='@/lib/current-membership')return {getCurrentMembership:async()=>actor};if(request==='next/headers')return {cookies:async()=>({get:()=>({value:activeBranch})})};if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));return load.call(this,request,parent,main);};
    const report=require('../src/app/api/reports/route.ts'), exporting=require('../src/app/api/reports/export/route.ts');
    const refund=require('../src/app/api/orders/[id]/refund/route.ts'), invoices=require('../src/app/api/invoices/route.ts'), issue=require('../src/app/api/invoices/[id]/issue/route.ts'), payments=require('../src/app/api/payments/route.ts'), transfers=require('../src/app/api/finance/transfers/route.ts'), expenses=require('../src/app/api/expenses/route.ts'), cancelExpense=require('../src/app/api/expenses/[id]/cancel/route.ts'), entries=require('../src/app/api/current-accounts/[id]/entries/route.ts'), manualStock=require('../src/app/api/stock/movements/route.ts');
    const { reportRange }=require('../src/lib/reports.ts'),{rolePermissions}=require('../src/lib/permissions.ts');Module._load=load;
    const req=(method,url,body)=>new NextRequest('http://localhost'+url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
    const context=id=>({params:Promise.resolve({id})});
    const expect=async(r,status)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
    const query=(key,extra={})=>new URLSearchParams({report:key,preset:'custom',startDate:'2026-10-01',endDate:'2026-10-31',...extra});
    const get=async(key,extra={})=>expect(await report.GET(req('GET','/api/reports?'+query(key,extra))),200);
    const metric=(r,key)=>r.metrics.find(m=>m.key===key)?.value;
    const equals=(value,expected)=>assert(new Prisma.Decimal(value).eq(expected),`${value} != ${expected}`);
    const table=(r,key)=>r.tables.find(t=>t.key===key);
    const sale=async(total,extra={})=>db.order.create({data:{organizationId:org.id,branchId:branch.id,orderNumber:'R-'+crypto.randomUUID(),paymentMethod:'CASH',subtotal:total,total,createdAt:new Date('2026-10-20T10:00:00Z'),...(extra.customerId?{customerSnapshot:{name:customer.name,code:customer.code,type:customer.type}}:{}),...extra}});
    let order,invoice,expense;
    await t.test('1: 1000 gross less 100 discount = 900 net; exact line allocation',async()=>{
      order=await sale(900,{subtotal:1000,discountType:'FIXED',discountValue:100,discountAmount:100,customerId:customer.id});
      await db.orderItem.create({data:{orderId:order.id,productId:product.id,productName:product.name,quantity:1,unitPrice:1000,total:1000}});
      await db.financeTransaction.create({data:{organizationId:org.id,branchId:branch.id,accountId:cash.id,orderId:order.id,source:'POS_SALE',direction:'IN',amount:900,occurredAt:order.createdAt}});
      await db.branchStock.create({data:{organizationId:org.id,branchId:branch.id,productId:product.id,quantity:9,criticalLevel:2}});
      await db.branchStock.create({data:{organizationId:org.id,branchId:branch.id,productId:raw.id,quantity:8}});
      await db.stockMovement.create({data:{organizationId:org.id,branchId:branch.id,productId:product.id,type:'SALE',quantity:1,createdAt:order.createdAt}});
      const r=await get('sales');equals(metric(r,'gross'),1000);equals(metric(r,'discount'),100);equals(metric(r,'netSales'),900);equals(metric(r,'average'),900);equals(table(r,'products').rows[0].net,900);
    });
    await t.test('2: central full refund makes original sale cohort net zero and restores stock',async()=>{
      await expect(await refund.POST(req('POST','/api/orders/'+order.id+'/refund'),context(order.id)),200);
      await db.financeTransaction.updateMany({where:{orderId:order.id,source:'POS_REFUND'},data:{occurredAt:new Date('2026-10-21T10:00:00Z')}});
      await db.stockMovement.updateMany({where:{organizationId:org.id,type:'RETURN'},data:{createdAt:new Date('2026-10-21T10:00:00Z')}});
      const r=await get('sales');equals(metric(r,'netSales'),0);equals(metric(r,'returned'),900);equals(metric(r,'completedCount'),0);equals((await get('stock')).tables.find(t=>t.key==='stock').rows.find(r=>r.name===product.name).quantity,10);
      const restated=await get('sales',{startDate:'2026-10-20',endDate:'2026-10-20'});equals(metric(restated,'netSales'),0);
    });
    await t.test('3: cash and card are separate; cancelled orders never count',async()=>{
      const o=await sale(200,{paymentMethod:'CARD',customerId:customer.id});await db.orderItem.create({data:{orderId:o.id,productId:product.id,productName:product.name,quantity:1,unitPrice:200,total:200}});await db.financeTransaction.create({data:{organizationId:org.id,branchId:branch.id,accountId:card.id,orderId:o.id,source:'POS_SALE',direction:'IN',amount:200,occurredAt:o.createdAt}});
      await sale(999,{status:'CANCELLED'});const r=await get('sales');equals(metric(r,'netSales'),200);equals(metric(r,'cash'),0);equals(metric(r,'card'),200);equals(metric(r,'completedCount'),1);
    });
    await t.test('4: purchase invoice draft and issue accrue debt but never create cash',async()=>{
      const before=await db.financeTransaction.count({where:{organizationId:org.id}});
      invoice=(await expect(await invoices.POST(req('POST','/api/invoices',{type:'PURCHASE',supplierId:supplier.id,currentAccountId:supplierCard.id,branchId:branch.id,number:'I-'+seed,invoiceDate:'2026-10-20',dueDate:'2026-10-21',priceMode:'TAX_EXCLUSIVE',items:[{description:'Materials',unit:'Adet',quantity:'1',unitPrice:'500',vatRate:'0'}],idempotencyKey:crypto.randomUUID()})),201)).invoice;
      invoice=(await expect(await issue.POST(req('POST','/api/invoices/'+invoice.id+'/issue',{expectedVersion:invoice.version}),context(invoice.id)),200)).invoice;
      assert.equal(await db.financeTransaction.count({where:{organizationId:org.id}}),before);const r=await get('finance');equals(metric(r,'netSales'),200);equals(metric(r,'cashFlow'),200);equals(metric(r,'invoicePayable'),500);
    });
    await t.test('5: current-account collection is cash, not another sale',async()=>{
      await expect(await entries.POST(req('POST','/api/current-accounts/'+customerCard.id+'/entries',{kind:'OPENING',direction:'DEBIT',amount:'300',occurredAt:'2026-10-01',branchId:branch.id,idempotencyKey:crypto.randomUUID()}),context(customerCard.id)),201);
      await expect(await payments.POST(req('POST','/api/payments',{type:'CUSTOMER_COLLECTION',currentAccountId:customerCard.id,branchId:branch.id,accountId:cash.id,amount:'100',paidAt:'2026-10-21',idempotencyKey:crypto.randomUUID()})),201);
      const r=await get('finance');equals(metric(r,'netSales'),200);equals(metric(r,'cashFlow'),300);equals(metric(r,'receivable'),200);
    });
    await t.test('6: central transfer excluded from operating flow, separately visible in account balances',async()=>{
      await expect(await transfers.POST(req('POST','/api/finance/transfers',{fromAccountId:cash.id,toAccountId:bank.id,amount:'100',idempotencyKey:crypto.randomUUID()})),201);
      await db.financeTransaction.updateMany({where:{organizationId:org.id,source:'MANUAL'},data:{occurredAt:new Date('2026-10-21T12:00:00Z')}});
      const r=await get('finance');equals(metric(r,'cashFlow'),300);equals(metric(r,'expenses'),0);const f=table(r,'flows').rows.find(r=>r.id==='TRANSFER');equals(f.incoming,100);equals(f.outgoing,100);equals(table(r,'accounts').rows.find(r=>r.id===bank.id).closing,100);
    });
    await t.test('7: supplier invoice payment is not a second expense',async()=>{
      expense=(await expect(await expenses.POST(req('POST','/api/expenses',{branchId:branch.id,title:'Rent',categoryId:category.id,amount:'100',expenseDate:'2026-10-20',idempotencyKey:crypto.randomUUID()})),201)).expense;
      await expect(await payments.POST(req('POST','/api/payments',{type:'PURCHASE_INVOICE_PAYMENT',invoiceId:invoice.id,branchId:branch.id,accountId:cash.id,amount:'50',paidAt:'2026-10-21',idempotencyKey:crypto.randomUUID()})),201);
      const r=await get('finance');equals(metric(r,'expenses'),100);equals(metric(r,'netSales'),200);equals(metric(r,'cashFlow'),250);equals(metric(r,'invoicePayable'),450);equals(metric(r,'overduePayable'),450);equals(metric(r,'overdueReceivable'),0);const s=await get('suppliers');equals(metric(s,'purchase'),500);equals(metric(s,'paid'),50);
    });
    await t.test('8: cancelled expense excluded from period managerial costs',async()=>{
      await expect(await cancelExpense.POST(req('POST','/api/expenses/'+expense.id+'/cancel',{reason:'Correction',expectedVersion:expense.version}),context(expense.id)),200);
      const r=await get('finance');equals(metric(r,'expenses'),0);equals(metric(r,'managementDifference'),200);assert.equal(table(r,'categories').rows.length,0);
    });
    await t.test('9: source/unit-specific stock entries, exits and recipe consumption',async()=>{
      for(const [type,quantity] of [['ADJUSTMENT_IN','3'],['ADJUSTMENT_OUT','2']])await expect(await manualStock.POST(req('POST','/api/stock/movements',{idempotencyKey:crypto.randomUUID(),productId:product.id,branchId:branch.id,type,quantity})),201);
      await db.stockMovement.updateMany({where:{organizationId:org.id,type:{in:['ADJUSTMENT_IN','ADJUSTMENT_OUT']}},data:{createdAt:new Date('2026-10-22T12:00:00Z')}});
      await db.stockMovement.create({data:{organizationId:org.id,branchId:branch.id,productId:raw.id,type:'PRODUCTION_OUT',quantity:2,createdAt:new Date('2026-10-20T10:00:00Z')}});
      const r=await get('stock');const flows=table(r,'stockFlows').rows;equals(flows.find(r=>r.type==='ADJUSTMENT_IN').quantity,3);equals(flows.find(r=>r.type==='ADJUSTMENT_OUT').quantity,2);equals(table(r,'ingredients').rows[0].quantity,2);
    });
    await t.test('10: refund stock inflow and current quantity come from real records',async()=>{
      const r=await get('stock');equals(table(r,'stockFlows').rows.find(r=>r.type==='RETURN').quantity,1);equals(table(r,'stock').rows.find(r=>r.name===product.name).quantity,11);
    });
    await t.test('11: current cost cannot fabricate historical COGS/profit/margin; all profit queries execute',async()=>{
      await db.product.update({where:{id:product.id},data:{costPrice:999}});const r=await get('profit');assert.equal(metric(r,'profit'),null);for(const table of r.tables)for(const row of table.rows)assert.equal(row.profit,null);assert(r.warnings.some(s=>s.includes('maliyet')));
    });
    await t.test('12: branch reports, comparison and empty branch scope fail closed',async()=>{
      await sale(700,{branchId:b.id});const r=await get('branches');equals(table(r,'branches').rows.find(r=>r.branch==='A').net,200);equals(table(r,'branches').rows.find(r=>r.branch==='B').net,700);assert(r.warnings.some(s=>s.includes('personel')));
      const original=actor;try{actor={...actor,role:'MANAGER',allBranches:false,branchAccess:[{branchId:branch.id}]};equals(metric(await get('sales'),'netSales'),200);await expect(await report.GET(req('GET','/api/reports?'+query('finance',{branchId:b.id}))),404);actor={...actor,branchAccess:[]};equals(metric(await get('sales'),'netSales'),0);equals(metric(await get('finance'),'payable'),0);}finally{actor=original;}
    });
    await t.test('13: tenant isolation and forged organization parameter rejected',async()=>{
      await db.order.create({data:{organizationId:foreignOrg.id,branchId:foreignBranch.id,orderNumber:'F-'+seed,paymentMethod:'CASH',subtotal:99999,total:99999,createdAt:new Date('2026-10-20T12:00:00Z')}});
      equals(metric(await get('sales'),'netSales'),900);await expect(await report.GET(req('GET','/api/reports?'+query('sales',{organizationId:foreignOrg.id}))),400);await expect(await report.GET(req('GET','/api/reports?'+query('sales',{branchId:foreignBranch.id}))),404);
      const original=actor;actor={...actor,organizationId:foreignOrg.id};try{equals(metric(await get('sales'),'netSales'),99999);}finally{actor=original;}
    });
    await t.test('14: direct API and exports enforce both reports and finance permissions',async()=>{
      const original=actor;actor={...actor,role:'CASHIER'};try{await expect(await report.GET(req('GET','/api/reports?'+query('finance'))),403);await expect(await exporting.GET(req('GET','/api/reports/export?'+query('sales',{format:'csv'}))),403);}finally{actor=original;}
      const manager=rolePermissions.MANAGER;rolePermissions.MANAGER=manager.filter(p=>p!=='finance.manage');actor={...actor,role:'MANAGER'};try{await expect(await report.GET(req('GET','/api/reports?'+query('finance'))),403);const r=await get('overview');assert(!r.metrics.some(m=>m.key==='payable'));assert(!r.tabs.includes('finance'));await expect(await exporting.GET(req('GET','/api/reports/export?'+query('finance',{format:'xlsx'}))),403);}finally{rolePermissions.MANAGER=manager;actor=original;}
    });
    await t.test('15: CSV/XLSX share server filters, export all pages and prevent formulas',async()=>{
      const r=await get('sales',{branchId:branch.id});equals(metric(r,'netSales'),200);
      const response=await exporting.GET(req('GET','/api/reports/export?'+query('sales',{branchId:branch.id,format:'csv'})));assert.equal(response.status,200);const csv=await response.text();assert(csv.includes('200,00')||csv.includes('"200"'));assert(csv.includes("'=HYPERLINK"));assert(csv.includes('Şube kapsamı'));assert(csv.includes('"A"'));
      const x=await exporting.GET(req('GET','/api/reports/export?'+query('sales',{branchId:branch.id,format:'xlsx'})));assert.equal(x.status,200);const bytes=Buffer.from(await x.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert(bytes.includes(Buffer.from('t="inlineStr"')));assert(!bytes.includes(Buffer.from('<f>')));assert(bytes.includes(Buffer.from('HYPERLINK')));
      let offset=0,parts=0;while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),name=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+name+extra;assert.equal(require('node:zlib').crc32(bytes.subarray(start,start+size)),bytes.readUInt32LE(offset+14));offset=start+size;parts++;}assert.equal(parts,6);
      // Keep a synthetic-only artifact for ZIP/XML verification (no customer data).
      const target=path.join(__dirname,'../.tools/reports-test.xlsx');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
      const customers=await get('customers');equals(table(customers,'customers').rows[0].net,200);equals(metric(customers,'activeCustomers'),1);
    });
    await t.test('16: empty period, date presets, UTC boundaries and malformed ranges',async()=>{
      const r=await get('sales',{startDate:'2025-01-01',endDate:'2025-01-01'});equals(metric(r,'netSales'),0);assert.equal(table(r,'sales').rows.length,0);
      const p=new URLSearchParams({preset:'today'});const dates=reportRange(p,new Date('2026-10-23T22:30:00Z'));assert.equal(dates.start.toISOString(),'2026-10-23T21:00:00.000Z');assert.equal(dates.end.toISOString(),'2026-10-24T21:00:00.000Z');
      assert.equal(reportRange(new URLSearchParams({preset:'previousMonth'}),new Date('2026-01-02T00:00:00Z')).startDay,'2025-12-01');
      assert.equal(reportRange(new URLSearchParams({preset:'custom',startDate:'2015-01-01',endDate:'2015-01-01'})).start.toISOString(),'2014-12-31T22:00:00.000Z');
      await expect(await report.GET(req('GET','/api/reports?'+query('sales',{startDate:'2026-02-30'}))),400);await expect(await report.GET(req('GET','/api/reports?'+query('sales',{startDate:'2026-11-01',endDate:'2026-10-01'}))),400);
    });
    await t.test('sub-cent line allocation reconciles, pagination cannot change KPI and read APIs have no writes',async()=>{
      const o=await sale('0.01',{subtotal:'0.03',discountType:'FIXED',discountValue:'0.02',discountAmount:'0.02'});
      await db.orderItem.createMany({data:[1,2,3].map(i=>({orderId:o.id,productId:product.id,productName:'Tiny '+i,quantity:1,unitPrice:'0.01',total:'0.01'}))});
      const before=await db.auditLog.count();const r=await get('sales',{branchId:branch.id});equals(metric(r,'netSales'),'200.01');equals(table(r,'products').rows.reduce((n,r)=>n.plus(r.net),new Prisma.Decimal(0)),'200.01');equals(metric(await get('sales',{branchId:branch.id,page:'2'}),'netSales'),'200.01');assert.equal(await db.auditLog.count(),before);
      for(const key of ['overview','finance','stock','profit','customers','suppliers','branches'])await get(key,{branchId:branch.id});
    });
    await t.test('timezone midnight boundaries, zero-filled trend and period-vs-current labels',async()=>{
      await sale(333,{createdAt:new Date('2026-10-20T21:00:00Z')});
      equals(metric(await get('sales',{branchId:branch.id,startDate:'2026-10-21',endDate:'2026-10-21'}),'netSales'),333);
      const r=await get('overview',{branchId:branch.id,startDate:'2025-02-01',endDate:'2025-02-07'});assert.equal(r.charts.find(c=>c.key==='trend').rows.length,7);equals(metric(r,'receivable'),200);
      for(const grain of ['week','month'])await get('overview',{grain});
      fs.writeFileSync(path.join(__dirname,'../.tools/reports-preview.json'),JSON.stringify(await get('finance',{branchId:branch.id}))); 
    });
    await t.test('export row cap rejects oversized results before materializing detail history',async()=>{
      for(let batch=0;batch<11;batch++)await db.stockMovement.createMany({data:Array.from({length:batch===10?1:1000},()=>({organizationId:org.id,branchId:branch.id,productId:raw.id,type:'ADJUSTMENT_IN',quantity:1,createdAt:new Date('2026-10-25T10:00:00Z')}))});
      await expect(await exporting.GET(req('GET','/api/reports/export?'+query('stock',{format:'csv'}))),422);
    });
  } finally {Module._load=load;await db.$disconnect();}
});
