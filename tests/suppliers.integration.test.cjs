/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated localhost database, never Neon. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('PostgreSQL suppliers: 16 requested scenarios plus accounting identity and cancellation integrity', { skip: process.env.WELLPOS_SUPPLIERS_DB_TEST !== '1', timeout: 240000 }, async t => {
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Never seed Neon');
  for (const ext of ['.ts','.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
  const { PrismaClient, Prisma } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }), load = Module._load, log = console.error;
  let actor, activeBranch, fail = '';
  const client = new Proxy(db, { get(target, key) { if (key === '$transaction') return (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) { const model = Reflect.get(target, key, target); if (key === fail) return new Proxy(model, { get(target, key) { return key === 'create' ? async () => { throw Error('Injected supplier failure'); } : Reflect.get(target, key, target); } }); return model; } })), options); return Reflect.get(target, key, target); } });
  try {
    const seed = crypto.randomUUID().replaceAll("-", "").slice(0,16).toUpperCase(), org = await db.organization.create({ data: { name: 'Supplier fixture', slug: 'suppliers-' + seed } }), otherOrg = await db.organization.create({ data: { name: 'Other supplier fixture', slug: 'suppliers-other-' + seed } }), user = await db.user.create({ data: { email: seed + '@example.test' } });
    const branch = await db.branch.create({ data: { organizationId: org.id, name: 'A' } }), branchB = await db.branch.create({ data: { organizationId: org.id, name: 'B' } });
    const cash = await db.financeAccount.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Supplier cash', type: 'CASH', openingBalance: 10000 } });
    const raw = await db.product.create({ data: { organizationId: org.id, name: 'Flour', price: 0, isSellable: false } });
    await db.branchStock.create({ data: { organizationId: org.id, branchId: branch.id, productId: raw.id, quantity: 25 } });
    actor = { userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] }; activeBranch = branch.id;
    Module._load = function(request, parent, main) { if (request === '@/lib/prisma') return { prisma: client }; if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor }; if (request === 'next/headers') return { cookies: async () => ({ get: () => ({ value: activeBranch }) }) }; if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2)); return load.call(this, request, parent, main); };
    const root = require('../src/app/api/suppliers/route.ts'), detail = require('../src/app/api/suppliers/[id]/route.ts'), link = require('../src/app/api/suppliers/[id]/account/route.ts'), products = require('../src/app/api/suppliers/[id]/products/route.ts'), product = require('../src/app/api/suppliers/[id]/products/[productId]/route.ts'), options = require('../src/app/api/suppliers/options/route.ts');
    const invoices = require('../src/app/api/invoices/route.ts'), issue = require('../src/app/api/invoices/[id]/issue/route.ts'), invoiceCancel = require('../src/app/api/invoices/[id]/cancel/route.ts'), payments = require('../src/app/api/payments/route.ts'), cancelPayment = require('../src/app/api/payments/[id]/cancel/route.ts'), accounts = require('../src/app/api/current-accounts/route.ts'), accountDetail = require('../src/app/api/current-accounts/[id]/route.ts');
    const customers = require('../src/app/api/customers/route.ts');
    const entries = require('../src/app/api/current-accounts/[id]/entries/route.ts');
    const { rolePermissions } = require('../src/lib/permissions.ts'); Module._load = load;
    const req = (method, url, body) => new NextRequest('http://localhost' + url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const ctx = (id, productId) => ({ params: Promise.resolve({ id, ...(productId ? { productId } : {}) }) });
    const expect = async (r, status) => { assert.equal(r.status, status, await r.clone().text()); return r.json(); };
    const input = (changes = {}) => ({ code: 'T-' + crypto.randomUUID().toUpperCase(), name: 'Supplier', idempotencyKey: crypto.randomUUID(), ...changes });
    const create = async data => (await expect(await root.POST(req('POST','/api/suppliers', data)),201)).supplier;
    const get = async (id, query='') => expect(await detail.GET(req('GET','/api/suppliers/'+id+query),ctx(id)),200);
    const counts = async () => ({ suppliers: await db.supplier.count(), accounts: await db.currentAccount.count(), audit: await db.auditLog.count(), payments: await db.payment.count(), entries: await db.currentAccountEntry.count(), cash: await db.financeTransaction.count(), links: await db.supplierProduct.count() });
    const purchaseInput = (supplier, extra={}) => ({ type:'PURCHASE', supplierId:supplier.id, currentAccountId:supplier.currentAccountId, branchId:branch.id, number:'ALI-'+crypto.randomUUID(), invoiceDate:'2026-10-20', priceMode:'TAX_EXCLUSIVE', items:[{productId:raw.id,description:'Flour',unit:'KG',quantity:'10',unitPrice:'100',vatRate:'0'}], idempotencyKey:crypto.randomUUID(), ...extra });
    let plain, linked, second, invoice, payment, originalSnapshot;
    await t.test('1: create optional minimal supplier, automatic code and idempotent replay', async () => {
      const data=input({name:'Acme',phone:'+90 (555) 123 45 67',email:'TEST@EXAMPLE.COM',taxNumber:'1234567890',website:'https://example.test'}); plain=await create(data); assert.equal(plain.email,'test@example.com'); assert.equal(plain.currentAccountId,null);
      const replay=await expect(await root.POST(req('POST','/api/suppliers',data)),200); assert.equal(replay.supplier.id,plain.id);
      await expect(await root.POST(req('POST','/api/suppliers',{...data,name:'Changed'})),409);
      const auto=await create({name:'Automatic',idempotencyKey:crypto.randomUUID()}); assert.match(auto.code,/^TED-/);
      for(const invalid of [{phone:'abc'},{email:'bad'},{website:'javascript:alert(1)'},{taxNumber:'123'}]) await expect(await root.POST(req('POST','/api/suppliers',input(invalid))),400);
    });
    await t.test('2: edit profile and reject stale version / forged financial fields', async () => {
      plain=(await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+plain.id,{name:'Acme updated',contactName:'Ayşe',expectedVersion:plain.version}),ctx(plain.id)),200)).supplier;
      assert.equal(plain.contactName,'Ayşe'); await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+plain.id,{name:'stale',expectedVersion:1}),ctx(plain.id)),409);
      await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+plain.id,{balance:100,expectedVersion:plain.version}),ctx(plain.id)),400);
    });
    await t.test('3: normalized duplicate supplier code rejected per organization', async () => { await expect(await root.POST(req('POST','/api/suppliers',input({code:plain.code.toLowerCase()}))),409); });
    await t.test('4: link existing BOTH account shared with a Customer; immutable identity and guarded type', async () => {
      const card=await db.currentAccount.create({data:{organizationId:org.id,name:'Both party',code:'BOTH-'+seed,type:'BOTH'}});
      await db.customer.create({data:{organizationId:org.id,type:'CORPORATE',code:'CUSTOMER-'+seed,name:'Both party',currentAccountId:card.id,createdByUserId:user.id,idempotencyKey:crypto.randomUUID(),requestHash:'fixture'}});
      linked=await create(input({accountMode:'existing',currentAccountId:card.id})); assert.equal(linked.currentAccountId,card.id);
      await expect(await link.POST(req('POST','/api/suppliers/'+linked.id+'/account',{accountMode:'create',expectedVersion:1}),ctx(linked.id)),409);
      await expect(await accountDetail.PATCH(req('PATCH','/api/current-accounts/'+card.id,{type:'CUSTOMER'}),ctx(card.id)),409);
      await expect(await root.POST(req('POST','/api/suppliers',input({accountMode:'existing',currentAccountId:card.id}))),409);
    });
    await t.test('5: new supplier and SUPPLIER account created atomically; later attach cariless profile', async () => {
      second=await create(input({accountMode:'create',taxNumber:'2222222222'})); assert.equal((await db.currentAccount.findUnique({where:{id:second.currentAccountId}})).type,'SUPPLIER');
      plain=(await expect(await link.POST(req('POST','/api/suppliers/'+plain.id+'/account',{accountMode:'create',expectedVersion:plain.version}),ctx(plain.id)),200)).supplier;
      assert(plain.currentAccountId);
    });
    await t.test('6: duplicate firm tax identity blocked across supplier, customer and finance paths / concurrent creation', async () => {
      await expect(await root.POST(req('POST','/api/suppliers',input({accountMode:'create',taxNumber:'2222222222'}))),409);
      await expect(await accounts.POST(req('POST','/api/current-accounts',{code:'DUP-'+seed,name:'Duplicate',type:'SUPPLIER',taxNumber:'2222222222'})),409);
      await expect(await customers.POST(req('POST','/api/customers',{...input({taxNumber:'2222222222',accountMode:'create'}),type:'CORPORATE'})),409);
      await expect(await root.POST(req('POST','/api/suppliers',input({accountMode:'existing',currentAccountId:second.currentAccountId,taxNumber:'9999999999'}))),409);
      const requests=[input({accountMode:'create',taxNumber:'3333333333'}),input({accountMode:'create',taxNumber:'3333333333'})];
      const results=await Promise.all(requests.map(data=>root.POST(req('POST','/api/suppliers',data)))); assert.deepEqual(results.map(r=>r.status).sort(),[201,409]); assert.equal(await db.currentAccount.count({where:{organizationId:org.id,taxNumber:'3333333333'}}),1);
    });
    await t.test('7: link non-sellable ingredient with optional code/price and edit with version', async () => {
      const result=await expect(await products.POST(req('POST','/api/suppliers/'+linked.id+'/products',{productId:raw.id,supplierProductCode:'F-1',lastPurchasePrice:'98.50'}),ctx(linked.id)),201);
      await expect(await product.PATCH(req('PATCH','/api/suppliers/'+linked.id+'/products/'+raw.id,{lastPurchasePrice:'100',expectedVersion:result.product.version}),ctx(linked.id,raw.id)),200);
      const rows=(await get(linked.id)).products; assert.equal(rows[0].product.isSellable,false); assert.equal(rows[0].lastPurchasePrice,'100');
    });
    await t.test('8: same ingredient linked to a second supplier; duplicate relation rejected', async () => {
      await expect(await products.POST(req('POST','/api/suppliers/'+second.id+'/products',{productId:raw.id}),ctx(second.id)),201);
      await expect(await products.POST(req('POST','/api/suppliers/'+second.id+'/products',{productId:raw.id}),ctx(second.id)),409);
    });
    await t.test('9: product relationships produce no stock or financial movements', async () => {
      assert.equal((await db.branchStock.findUnique({where:{branchId_productId:{branchId:branch.id,productId:raw.id}}})).quantity.toString(),'25'); assert.equal(await db.stockMovement.count({where:{organizationId:org.id}}),0); assert.equal(await db.currentAccountEntry.count({where:{organizationId:org.id}}),0); assert.equal(await db.financeTransaction.count({where:{organizationId:org.id}}),0);
    });
    await t.test('10: supplier purchase draft resolves existing accounting identity without accrual', async () => {
      const body=purchaseInput(linked); invoice=(await expect(await invoices.POST(req('POST','/api/invoices',body)),201)).invoice;
      assert.equal((await get(linked.id)).finance.balance,'0'); await expect(await invoices.POST(req('POST','/api/invoices',body)),200);
      await expect(await invoices.POST(req('POST','/api/invoices',purchaseInput(linked,{currentAccountId:second.currentAccountId}))),409);
    });
    await t.test('11: issuing creates exactly one payable; reissue blocked, snapshot remains immutable', async () => {
      invoice=(await expect(await issue.POST(req('POST','/api/invoices/'+invoice.id+'/issue',{expectedVersion:invoice.version}),ctx(invoice.id)),200)).invoice; originalSnapshot=invoice.snapshot;
      await expect(await issue.POST(req('POST','/api/invoices/'+invoice.id+'/issue',{expectedVersion:1}),ctx(invoice.id)),409);
      const data=await get(linked.id); assert.equal(data.finance.balance,'-1000'); assert.equal(data.finance.statistics.purchaseTotal,'1000'); assert.equal(data.finance.invoices[0].paymentStatus,'UNPAID');
      const profile=data.supplier; await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+linked.id,{name:'Renamed profile',expectedVersion:profile.version}),ctx(linked.id)),200);
      assert.deepEqual((await db.invoice.findUnique({where:{id:invoice.id}})).snapshot,originalSnapshot);
    });
    await t.test('12: partial purchase payment uses central Payment and allocation exactly once', async () => {
      const body={type:'PURCHASE_INVOICE_PAYMENT',invoiceId:invoice.id,currentAccountId:linked.currentAccountId,branchId:branch.id,accountId:cash.id,amount:'250',paidAt:'2026-10-21',idempotencyKey:crypto.randomUUID()};
      payment=(await expect(await payments.POST(req('POST','/api/payments',body)),201)).payment; await expect(await payments.POST(req('POST','/api/payments',body)),200);
      const data=await get(linked.id); assert.equal(data.finance.balance,'-750'); assert.equal(data.finance.invoices[0].remainingAmount,'750'); assert.equal(data.finance.statistics.invoicePaid,'250'); assert.equal(data.finance.statistics.totalPaid,'250');
    });
    await t.test('13: central payment updates cash and cari in one transaction; no stock impact', async () => {
      const movements=await db.financeTransaction.findMany({where:{accountId:cash.id}});const balance=movements.reduce((n,row)=>row.direction==='IN'?n.plus(row.amount):n.minus(row.amount),new Prisma.Decimal(10000)); assert.equal(balance.toString(),'9750'); assert.equal(movements.length,1);assert.equal(await db.payment.count({where:{organizationId:org.id}}),1);assert.equal(await db.stockMovement.count({where:{organizationId:org.id}}),0);
    });
    await t.test('14: deactivate financial-history supplier; preserve invoices/payments and allow debt settlement', async () => {
      const profile=(await get(linked.id)).supplier; await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+linked.id,{isActive:false,expectedVersion:profile.version}),ctx(linked.id)),200);
      const historic=await get(linked.id);assert.equal(historic.supplier.isActive,false);assert.equal(historic.finance.invoices.length,1);assert.equal(historic.finance.payments.length,1); assert(!('DELETE' in detail));
      assert((await expect(await root.GET(req('GET','/api/suppliers?active=false')),200)).suppliers.some(s=>s.id===linked.id));
      await expect(await payments.POST(req('POST','/api/payments',{type:'PURCHASE_INVOICE_PAYMENT',invoiceId:invoice.id,currentAccountId:linked.currentAccountId,branchId:branch.id,accountId:cash.id,amount:'50',paidAt:'2026-10-21',idempotencyKey:crypto.randomUUID()})),201);
      assert.equal((await get(linked.id)).finance.balance,'-700');
    });
    await t.test('15: tenant isolation for reads, writes, product links, cari links and composite foreign keys', async () => {
      const original=actor;actor={...actor,organizationId:otherOrg.id};await expect(await detail.GET(req('GET','/api/suppliers/'+linked.id),ctx(linked.id)),404);await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+linked.id,{name:'Hack',expectedVersion:1}),ctx(linked.id)),404);
      await expect(await products.POST(req('POST','/api/suppliers/'+linked.id+'/products',{productId:raw.id}),ctx(linked.id)),404);
      const foreign=await create(input({code:plain.code}));actor=original;await expect(await products.POST(req('POST','/api/suppliers/'+second.id+'/products',{productId:(await db.product.create({data:{organizationId:otherOrg.id,name:'Foreign',price:1}})).id}),ctx(second.id)),404);
      await assert.rejects(db.supplierProduct.create({data:{organizationId:org.id,supplierId:foreign.id,productId:raw.id}}),e=>e.code==='P2003');
      await expect(await root.POST(req('POST','/api/suppliers',input({expectedOrganizationId:otherOrg.id}))),409);
    });
    await t.test('16: unauthorized roles cannot change supplier, read finance or pay', async () => {
      const original=actor;actor={...actor,role:'CASHIER'};await expect(await root.GET(req('GET','/api/suppliers')),403); await expect(await root.POST(req('POST','/api/suppliers',input())),403);await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+plain.id,{name:'Hack',expectedVersion:plain.version}),ctx(plain.id)),403);await expect(await payments.POST(req('POST','/api/payments',{})),403);actor=original;
      const manager=rolePermissions.MANAGER; rolePermissions.MANAGER=manager.filter(p=>p!=='finance.manage');actor={...actor,role:'MANAGER'};
      try { const masked=await create(input());for(const key of ['currentAccountId','requestHash','idempotencyKey','createdByUserId'])assert(!Object.hasOwn(masked,key));const edited=(await expect(await detail.PATCH(req('PATCH','/api/suppliers/'+masked.id,{name:'Masked update',expectedVersion:masked.version}),ctx(masked.id)),200)).supplier;assert(!Object.hasOwn(edited,'currentAccountId'));const response=await get(second.id);assert(!('finance' in response));assert(!('currentAccountId' in response.supplier));assert(!('lastPurchasePrice' in response.products[0]));await expect(await products.POST(req('POST','/api/suppliers/'+second.id+'/products',{productId:raw.id,lastPurchasePrice:5}),ctx(second.id)),403); } finally {rolePermissions.MANAGER=manager;actor=original;}
    });
    await t.test('branch balances and financial history fail closed, even without branch filter', async () => {
      const original=actor;actor={...actor,role:'MANAGER',allBranches:false,branchAccess:[{branchId:branchB.id}]};
      const result=await get(linked.id);assert.equal(result.finance.balance,'0');assert.equal(result.finance.invoices.length,0);assert.equal(result.finance.payments.length,0);assert.equal(result.finance.statistics.purchaseTotal,'0');await expect(await detail.GET(req('GET','/api/suppliers/'+linked.id+'?branchId='+branch.id),ctx(linked.id)),404);actor={...actor,branchAccess:[]};assert.equal((await get(linked.id)).finance.balance,'0');actor=original;
    });
    await t.test('cancelled payments reverse both ledgers and disappear from statistics; cancelled invoices do not accrue', async () => {
      await expect(await cancelPayment.POST(req('POST','/api/payments/'+payment.id+'/cancel',{reason:'Fixture correction'}),ctx(payment.id)),200);
      let result=await get(linked.id);assert.equal(result.finance.balance,'-950');assert.equal(result.finance.statistics.totalPaid,'50');assert.equal(result.finance.statistics.invoicePaid,'50');assert(result.finance.payments.find(p=>p.id===payment.id).cancelledAt);
      let cancelled=(await expect(await invoices.POST(req('POST','/api/invoices',purchaseInput(second))),201)).invoice;cancelled=(await expect(await issue.POST(req('POST','/api/invoices/'+cancelled.id+'/issue',{expectedVersion:1}),ctx(cancelled.id)),200)).invoice;await expect(await invoiceCancel.POST(req('POST','/api/invoices/'+cancelled.id+'/cancel',{expectedVersion:cancelled.version,reason:'Cancelled fixture'}),ctx(cancelled.id)),200);
      result=await get(second.id);assert.equal(result.finance.statistics.purchaseTotal,'0');assert.equal(result.finance.balance,'0');assert.equal(result.finance.invoices[0].status,'CANCELLED');
    });
    await t.test('atomic rollback on supplier, cari or audit failure; private creation metadata omitted', async () => {
      for(const stage of ['supplier','currentAccount','auditLog']){const before=await counts();fail=stage;console.error=()=>{};try{await expect(await root.POST(req('POST','/api/suppliers',input({accountMode:'create'}))),500);}finally{fail='';console.error=log;}assert.deepEqual(await counts(),before);}
      const data=await get(plain.id);for(const key of ['requestHash','idempotencyKey','createdByUserId'])assert(!Object.hasOwn(data.supplier,key));
      const choices=await expect(await options.GET(req('GET','/api/suppliers/options?q=Flour')),200);assert(choices.products.some(p=>p.id===raw.id));
      const selected=await expect(await options.GET(req('GET','/api/suppliers/options?q=no-match&supplierId='+second.id)),200);assert(selected.suppliers.some(s=>s.id===second.id));
    });
    await t.test('one cari cannot be claimed by two concurrent supplier profiles', async () => {
      const card=await db.currentAccount.create({data:{organizationId:org.id,name:'Race party',code:'RACE-'+seed,type:'SUPPLIER'}});
      const results=await Promise.all([1,2].map(()=>root.POST(req('POST','/api/suppliers',input({accountMode:'existing',currentAccountId:card.id})))));
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(await db.supplier.count({where:{currentAccountId:card.id}}),1);
    });
    await t.test('BOTH customer collections do not inflate supplier payments; passive supplier debt remains in list summary', async () => {
      const before=await get(linked.id);
      await expect(await entries.POST(req('POST','/api/current-accounts/'+linked.currentAccountId+'/entries',{kind:'OPENING',direction:'DEBIT',amount:'200',branchId:branchB.id,idempotencyKey:crypto.randomUUID()}),ctx(linked.currentAccountId)),201);
      const cashB=await db.financeAccount.create({data:{organizationId:org.id,branchId:branchB.id,name:'B Cash',type:'CASH'}});
      await expect(await payments.POST(req('POST','/api/payments',{type:'CUSTOMER_COLLECTION',currentAccountId:linked.currentAccountId,branchId:branchB.id,accountId:cashB.id,amount:'100',idempotencyKey:crypto.randomUUID()})),201);
      const after=await get(linked.id);assert.equal(after.finance.statistics.totalPaid,before.finance.statistics.totalPaid);assert(after.finance.payments.every(p=>p.type!=='CUSTOMER_COLLECTION'));
      const list=await expect(await root.GET(req('GET','/api/suppliers?q=does-not-match&active=true')),200);assert.equal(list.suppliers.length,0);assert.equal(list.summary.payable,'850');
    });
  } finally { Module._load=load;console.error=log;await db.$disconnect(); }
});
