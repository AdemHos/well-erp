/* eslint-disable @typescript-eslint/no-require-imports -- Real localhost-only customer, POS and finance integration with concurrent connections. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('PostgreSQL customers: requested 15 scenarios, identity, permissions and POS compatibility', { skip: process.env.WELLPOS_CUSTOMERS_DB_TEST !== '1', timeout: 240000 }, async t => {
  const url = new URL(process.env.DATABASE_URL); assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'Customer fixtures must never use Neon');
  for (const ext of ['.ts','.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
  const { PrismaClient, Prisma } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }), load = Module._load, log = console.error;
  let actor, activeBranch, fail = '';
  const client = new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) {
      const model = Reflect.get(target, key, target);
      if (key === fail) return new Proxy(model, { get(target, key) { return key === 'create' ? async () => { throw Error('Injected customer failure'); } : Reflect.get(target, key, target); } });
      return model;
    } })), options);
    return Reflect.get(target, key, target);
  } });
  try {
    const seed = crypto.randomUUID(), org = await db.organization.create({ data: { name: 'Customer fixture', slug: 'customers-' + seed } }), user = await db.user.create({ data: { email: seed + '@example.test', name: 'Tester' } });
    const otherOrg = await db.organization.create({ data: { name: 'Other fixture', slug: 'customers-other-' + seed } });
    const branch = await db.branch.create({ data: { organizationId: org.id, name: 'A' } }), branchB = await db.branch.create({ data: { organizationId: org.id, name: 'B' } });
    const cash = await db.financeAccount.create({ data: { organizationId: org.id, branchId: branch.id, name: 'A Cash', type: 'CASH', openingBalance: 10000 } });
    const cashB = await db.financeAccount.create({ data: { organizationId: org.id, branchId: branchB.id, name: 'B Cash', type: 'CASH', openingBalance: 10000 } });
    const product = await db.product.create({ data: { organizationId: org.id, name: 'Product snapshot', price: 100 } });
    for (const b of [branch, branchB]) await db.branchStock.create({ data: { organizationId: org.id, branchId: b.id, productId: product.id, quantity: 100 } });
    actor = { userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] }; activeBranch = branch.id;
    Module._load = function(request, parent, main) {
      if (request === '@/lib/prisma') return { prisma: client };
      if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
      if (request === 'next/headers') return { cookies: async () => ({ get: () => ({ value: activeBranch }) }) };
      if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
      return load.call(this, request, parent, main);
    };
    const root = require('../src/app/api/customers/route.ts'), detail = require('../src/app/api/customers/[id]/route.ts'), link = require('../src/app/api/customers/[id]/account/route.ts'), lookup = require('../src/app/api/customers/lookup/route.ts'), options = require('../src/app/api/customers/options/route.ts'), saleDetail = require('../src/app/api/customers/[id]/orders/[orderId]/route.ts');
    const orders = require('../src/app/api/orders/route.ts'), refund = require('../src/app/api/orders/[id]/refund/route.ts'), invoices = require('../src/app/api/invoices/route.ts'), issue = require('../src/app/api/invoices/[id]/issue/route.ts'), payments = require('../src/app/api/payments/route.ts'), accounts = require('../src/app/api/current-accounts/[id]/route.ts');
    const { ReceiptContent } = require('../src/components/pos/SaleReceipt.tsx'); Module._load = load;
    const req = (method, url, body) => new NextRequest('http://localhost' + url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const ctx = id => ({ params: Promise.resolve({ id }) });
    const expect = async (r, status) => { assert.equal(r.status, status, await r.clone().text()); return r.json(); };
    const input = (changes = {}) => ({ type: 'INDIVIDUAL', code: 'C-' + crypto.randomUUID().toUpperCase(), name: 'Test customer', idempotencyKey: crypto.randomUUID(), ...changes });
    const create = async b => (await expect(await root.POST(req('POST', '/api/customers', b)), 201)).customer;
    const get = async (id, query = '') => expect(detail.GET ? await detail.GET(req('GET', '/api/customers/' + id + query), ctx(id)) : null, 200);
    const counts = async () => Promise.all(['customer','currentAccount','currentAccountEntry','financeTransaction','order','auditLog'].map(m => db[m].count({ where: { organizationId: org.id } })));
    const sell = async (customerId, branchId = branch.id, extra = {}) => orders.POST(req('POST', '/api/orders', { idempotencyKey: crypto.randomUUID(), branchId, paymentMethod: 'CASH', financeAccountId: branchId === branch.id ? cash.id : cashB.id, items: [{ productId: product.id, quantity: 1 }], ...(customerId ? { customerId } : {}), ...extra }));
    let individual, corporate, linked, sale, guest;
    await t.test('1: create individual, optional fields and normalized business code', async () => {
      individual = await create(input({ name: 'Ayşe İğdır', code: ' individual-1 ', phone: '+90 (555) 123-4567', city: 'İstanbul', district: 'Kadıköy' }));
      assert.equal(individual.code, 'INDIVIDUAL-1'); assert.equal(individual.currentAccountId, null); assert.equal(individual.email, null);
    });
    await t.test('2: create corporate with optional tax data', async () => {
      corporate = await create(input({ type: 'CORPORATE', name: 'Örnek A.Ş.', taxOffice: 'Kadıköy', taxNumber: '1234567890', email: 'TEST@EXAMPLE.TEST' }));
      assert.equal(corporate.email, 'test@example.test'); await create(input({ type: 'CORPORATE', name: 'Optional tax' }));
      for (const fields of [{ phone: 'abc' }, { email: 'bad' }, { type: 'CORPORATE', taxNumber: '123' }, { taxOffice: 'No individual tax' }, { isActive: 'yes' }]) await expect(await root.POST(req('POST','/api/customers',input(fields))),400);
    });
    await t.test('3: duplicate code rejected, same request replays once and changed request conflicts', async () => {
      await expect(await root.POST(req('POST','/api/customers',input({ code: individual.code }))),409);
      const body = input({ accountMode: 'create' }); const before = await counts();
      const replies = await Promise.all([root.POST(req('POST','/api/customers',body)),root.POST(req('POST','/api/customers',body))]); assert.deepEqual(replies.map(r=>r.status).sort(),[200,201]);
      const after = await counts(); assert.equal(after[0]-before[0],1); assert.equal(after[1]-before[1],1);
      await expect(await root.POST(req('POST','/api/customers',{...body,name:'Different'})),409);
    });
    await t.test('automatic codes: concurrent replay, distinct profiles and accounting links', async () => {
      const body=input({code:undefined,accountMode:'create'}), before=await counts();
      const replies=await Promise.all([root.POST(req('POST','/api/customers',body)),root.POST(req('POST','/api/customers',body))]);
      assert.deepEqual(replies.map(r=>r.status).sort(),[200,201]);
      const results=await Promise.all(replies.map(r=>r.json())), c=results[0].customer;
      assert.match(c.code,/^MUS-[A-F0-9]{16}$/);assert.equal(results[1].customer.code,c.code);assert.equal(results[1].customer.id,c.id);
      const after=await counts();assert.equal(after[0]-before[0],1);assert.equal(after[1]-before[1],1);
      assert.equal((await db.currentAccount.findUnique({where:{id:c.currentAccountId}})).code,c.code);
      const other=await create(input({code:undefined}));assert.notEqual(other.code,c.code);
      const card=await db.currentAccount.create({data:{organizationId:org.id,code:'AUTO-LINK-EXISTING',name:'Existing billing',type:'CUSTOMER'}});
      const linked=await create(input({code:undefined,accountMode:'existing',currentAccountId:card.id}));assert.equal(linked.currentAccountId,card.id);assert.match(linked.code,/^MUS-[A-F0-9]{16}$/);
      await expect(await root.POST(req('POST','/api/customers',{...body,name:'Different automatic customer'})),409);
    });
    await t.test('4: edit, preserve omitted fields and reject stale profile version', async () => {
      await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{ expectedVersion:1,name:'Ayşe Güncel' }),ctx(individual.id)),200);
      await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{ expectedVersion:1,name:'Stale' }),ctx(individual.id)),409);
      individual = (await get(individual.id)).customer; assert.equal(individual.phone,'+90 (555) 123-4567');
    });
    await t.test('5: link existing CUSTOMER/BOTH once, no duplicate ledger and no auto synchronization', async () => {
      const card = await db.currentAccount.create({data:{organizationId:org.id,code:'EXISTING-1',name:'Billing identity',type:'BOTH'}});
      const before=await counts(); linked=await create(input({code:card.code,name:'Profile identity',accountMode:'existing',currentAccountId:card.id})); const after=await counts();assert.equal(after[1],before[1]);assert.equal(after[2],before[2]);
      await expect(await accounts.PATCH(req('PATCH','/api/current-accounts/'+card.id,{name:'Billing updated'}),ctx(card.id)),200);assert.equal((await get(linked.id)).customer.name,'Profile identity');await expect(await detail.PATCH(req('PATCH','/api/customers/'+linked.id,{expectedVersion:1,name:'Profile edit'}),ctx(linked.id)),200);assert.equal((await db.currentAccount.findUnique({where:{id:card.id}})).name,'Billing updated');
      await expect(await accounts.PATCH(req('PATCH','/api/current-accounts/'+card.id,{type:'SUPPLIER'}),ctx(card.id)),409);
      await expect(await link.POST(req('POST','/api/customers/'+individual.id+'/account',{expectedVersion:individual.version,accountMode:'existing',currentAccountId:card.id}),ctx(individual.id)),409);
      const available=(await expect(await options.GET(req('GET','/api/customers/options')),200)).accounts;assert(!available.some(a=>a.id===card.id));
    });
    await t.test('6: create optional current account, later link and race one shared account', async () => {
      const before=await counts(); const c=await create(input({accountMode:'create'}));const after=await counts();assert(c.currentAccountId);assert.equal(after[1]-before[1],1);assert.equal(after[2],before[2]);assert.equal(after[3],before[3]);
      const a=await create(input()),b=await create(input()),card=await db.currentAccount.create({data:{organizationId:org.id,code:'RACE-LINK',name:'Shared',type:'CUSTOMER'}});
      const replies=await Promise.all([a,b].map(c=>link.POST(req('POST','/api/customers/'+c.id+'/account',{expectedVersion:1,accountMode:'existing',currentAccountId:card.id}),ctx(c.id))));assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
      await expect(await link.POST(req('POST','/api/customers/'+c.id+'/account',{expectedVersion:1,accountMode:'existing',currentAccountId:card.id}),ctx(c.id)),409);
    });
    await t.test('7: selected customer POS sale preserves totals, stock, cash and server snapshot', async () => {
      const before=await counts(),stock=await db.branchStock.findUnique({where:{branchId_productId:{branchId:branch.id,productId:product.id}}});
      sale=(await expect(await sell(individual.id),201)).order;assert.equal(sale.customerId,individual.id);assert.equal(sale.total,'100');assert.equal(sale.customerSnapshot.name,'Ayşe Güncel');
      const after=await counts();assert.equal(after[3]-before[3],1);assert.equal(after[2],before[2]);assert.equal(after[4]-before[4],1);const updated=await db.branchStock.findUnique({where:{branchId_productId:{branchId:branch.id,productId:product.id}}});assert(updated.quantity.eq(stock.quantity.minus(1)));
      await expect(await sell(individual.id,branch.id,{customerSnapshot:{name:'Forged'}}),400);
    });
    await t.test('8: anonymous POS sale and legacy records stay unassigned', async () => {
      guest=(await expect(await sell(null),201)).order;const stored=await db.order.findUnique({where:{id:guest.id}});assert.equal(stored.customerId,null);assert.equal(stored.customerSnapshot,null);assert.equal(stored.total.toString(),sale.total);
    });
    await t.test('9: customer sales history, details and immutable reprinted customer data', async () => {
      let result=await get(individual.id);assert.equal(result.statistics.completedCount,1);assert.equal(result.statistics.netSpend,'100');assert.equal(result.statistics.averageBasket,'100');assert.equal(result.sales.orders[0].id,sale.id);
      await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{expectedVersion:result.customer.version,name:'New profile name'}),ctx(individual.id)),200);
      const response=await expect(await saleDetail.GET(req('GET',`/api/customers/${individual.id}/orders/${sale.id}`),{params:Promise.resolve({id:individual.id,orderId:sale.id})}),200);assert.equal(response.order.customerSnapshot.name,'Ayşe Güncel');
      const html=require('react-dom/server').renderToStaticMarkup(require('react').createElement(ReceiptContent,{order:response.order,showCustomer:true}));assert(html.includes('Ayşe Güncel'));assert(!html.includes('New profile name'));
      const hidden=require('react-dom/server').renderToStaticMarkup(require('react').createElement(ReceiptContent,{order:response.order}));assert(!hidden.includes('Ayşe Güncel'));
      result=await get(individual.id);assert.equal(result.sales.orders.length,1);
    });
    await t.test('10: full refund removes count, spend, average and last valid purchase', async () => {
      await expect(await refund.POST(req('POST','/api/orders/'+sale.id+'/refund',{}),ctx(sale.id)),200);const result=await get(individual.id);assert.equal(result.statistics.completedCount,0);assert.equal(result.statistics.netSpend,'0');assert.equal(result.statistics.averageBasket,'0');assert.equal(result.statistics.lastPurchaseAt,null);assert.equal(result.sales.orders[0].netAmount,'0');assert.equal(result.sales.orders[0].status,'REFUNDED');
    });
    await t.test('11: linked sales invoices use active payment allocation and branch-scoped ledger', async () => {
      const body={type:'SALES',number:'CUST-INVOICE',invoiceDate:'2026-01-01',branchId:branch.id,currentAccountId:linked.currentAccountId,priceMode:'TAX_EXCLUSIVE',items:[{description:'Service',unit:'Adet',quantity:'1',unitPrice:'2000',vatRate:'0'}],idempotencyKey:crypto.randomUUID()};
      const invoice=(await expect(await invoices.POST(req('POST','/api/invoices',body)),201)).invoice;await expect(await issue.POST(req('POST','/api/invoices/'+invoice.id+'/issue',{expectedVersion:1}),ctx(invoice.id)),200);
      await expect(await payments.POST(req('POST','/api/payments',{type:'SALES_INVOICE_COLLECTION',invoiceId:invoice.id,branchId:branch.id,accountId:cash.id,amount:'500',idempotencyKey:crypto.randomUUID()})),201);
      const result=await get(linked.id);assert.equal(result.finance.balance,'1500');assert.equal(result.finance.invoices[0].remainingAmount,'1500');assert.equal(result.finance.invoices[0].paymentStatus,'PARTIALLY_PAID');assert.equal(result.statistics.netSpend,'0');
    });
    await t.test('12: shared customer pool; history and totals respect branch scope', async () => {
      activeBranch=branchB.id;await expect(await sell(individual.id,branchB.id),201);activeBranch=branch.id;let result=await get(individual.id);assert.equal(result.statistics.completedCount,1);assert.equal(result.statistics.netSpend,'100');assert.equal(result.sales.orders.length,2);
      const original=actor;actor={...actor,role:'MANAGER',allBranches:false,branchAccess:[{branchId:branchB.id}]};result=await get(individual.id);assert.equal(result.sales.orders.length,1);assert.equal(result.branches.length,1);assert.equal(result.statistics.netSpend,'100');await expect(await detail.GET(req('GET','/api/customers/'+individual.id+'?branchId='+branch.id),ctx(individual.id)),404);
      await expect(await saleDetail.GET(req('GET',`/api/customers/${individual.id}/orders/${sale.id}`),{params:Promise.resolve({id:individual.id,orderId:sale.id})}),404);const list=await expect(await root.GET(req('GET','/api/customers')),200);assert(list.customers.some(c=>c.id===individual.id));actor=original;
    });
    await t.test('13: foreign tenant customer and accounting links fail without partial records', async () => {
      const original=actor;actor={...actor,organizationId:otherOrg.id};await expect(await detail.GET(req('GET','/api/customers/'+individual.id),ctx(individual.id)),404);await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{expectedVersion:1,name:'Hack'}),ctx(individual.id)),404);actor=original;
      await expect(await root.POST(req('POST','/api/customers',input({expectedOrganizationId:otherOrg.id}))),409);
      const foreign=await db.currentAccount.create({data:{organizationId:otherOrg.id,code:'FOREIGN-CARD',name:'Foreign',type:'CUSTOMER'}});const before=await counts();await expect(await root.POST(req('POST','/api/customers',input({accountMode:'existing',currentAccountId:foreign.id}))),409);assert.deepEqual(await counts(),before);
      actor={...actor,organizationId:otherOrg.id};const foreignCustomer=await create(input({code:individual.code,name:'Foreign same code'}));assert.equal(foreignCustomer.code,individual.code);actor=original;const isolated=await counts();await expect(await sell(foreignCustomer.id),409);assert.deepEqual(await counts(),isolated);await assert.rejects(db.order.create({data:{organizationId:org.id,branchId:branch.id,paymentMethod:'CASH',orderNumber:crypto.randomUUID(),subtotal:0,total:0,customerId:foreignCustomer.id,customerSnapshot:{name:foreignCustomer.name,code:foreignCustomer.code,type:foreignCustomer.type}}}),e=>e.code==='P2003');
    });
    await t.test('14: cashier lookup has no contact/financial payload and cannot manage profiles', async () => {
      const original=actor;actor={...actor,role:'CASHIER'};const result=await expect(await lookup.GET(req('GET','/api/customers/lookup?q=New')),200);assert(result.customers.some(c=>c.id===individual.id));const byPhone=await expect(await lookup.GET(req('GET','/api/customers/lookup?q=5551234567')),200);assert(byPhone.customers.some(c=>c.id===individual.id));for(const c of result.customers)assert.deepEqual(Object.keys(c).sort(),['code','id','name']);await expect(await root.GET(req('GET','/api/customers')),403);await expect(await root.POST(req('POST','/api/customers',input())),403);await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{expectedVersion:3,isActive:false}),ctx(individual.id)),403);await expect(await sell(corporate.id),201);actor=original;
    });
    await t.test('15: deactivate a customer with financial/sales history without removing links or documents', async () => {
      const profile=(await get(linked.id)).customer;await expect(await detail.PATCH(req('PATCH','/api/customers/'+linked.id,{expectedVersion:profile.version,isActive:false}),ctx(linked.id)),200);const result=await get(linked.id);assert.equal(result.customer.isActive,false);assert.equal(result.finance.invoices.length,1);assert.equal(result.finance.balance,'1500');assert.equal((await db.currentAccount.findUnique({where:{id:linked.currentAccountId}})).isActive,true);const before=await counts();await expect(await sell(linked.id),409);assert.deepEqual(await counts(),before);assert(!('DELETE' in detail));await expect(await payments.POST(req('POST','/api/payments',{type:'SALES_INVOICE_COLLECTION',invoiceId:result.finance.invoices[0].id,branchId:branch.id,accountId:cash.id,amount:'500',idempotencyKey:crypto.randomUUID()})),201);assert.equal((await get(linked.id)).finance.balance,'1000');const old=(await get(individual.id)).customer;await expect(await detail.PATCH(req('PATCH','/api/customers/'+individual.id,{expectedVersion:old.version,isActive:false}),ctx(individual.id)),200);const historic=await get(individual.id);assert.equal(historic.sales.orders.length,2);assert.equal(historic.statistics.netSpend,'100');assert.equal((await expect(await lookup.GET(req('GET','/api/customers/lookup?q=New')),200)).customers.length,0);
    });
    await t.test('customer/current-account/audit failure rolls back; metadata fields stay private', async () => {
      for(const stage of ['customer','currentAccount','auditLog']){const before=await counts();fail=stage;console.error=()=>{};try{await expect(await root.POST(req('POST','/api/customers',input({accountMode:'create'}))),500);}finally{fail='';console.error=log;}assert.deepEqual(await counts(),before,stage);}
      const audits=await db.auditLog.findMany({where:{organizationId:org.id,entityType:'Customer'}});for(const row of audits){const metadata=JSON.stringify(row.metadata);assert(!metadata.includes('+90'));assert(!metadata.includes('example.test'));assert(!metadata.includes('Profile identity'));}
      const result=await expect(await root.GET(req('GET','/api/customers?type=CORPORATE&limit=1')),200);assert.equal(result.customers.length,1);assert(result.customers.every(c=>c.type==='CORPORATE'));assert(result.summary.total>result.customers.length);assert(!('requestHash' in result.customers[0]));
    });
    void Prisma;
  } finally { Module._load=load;console.error=log;await db.$disconnect(); }
});
