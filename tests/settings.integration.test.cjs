/* eslint-disable @typescript-eslint/no-require-imports -- Actual APIs and localhost PostgreSQL only. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('management settings: persistence, policies, isolation, history and audit', { skip: process.env.WELLPOS_SETTINGS_DB_TEST !== '1', timeout: 180000 }, async t => {
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'No Neon fixtures');
  require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,f);
  const { PrismaClient, Prisma } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }), load = Module._load;
  let actor, activeBranch;
  try {
    const seed=crypto.randomUUID(), org=await db.organization.create({data:{name:'Original business',slug:'settings-'+seed}}), foreign=await db.organization.create({data:{name:'Foreign',slug:'other-settings-'+seed}});
    const user=await db.user.create({data:{email:seed+'@settings.test', name:'Owner'}});
    const a=await db.branch.create({data:{organizationId:org.id,name:'A'}}), b=await db.branch.create({data:{organizationId:org.id,name:'B'}}), c=await db.branch.create({data:{organizationId:foreign.id,name:'C'}});
    const owner={id:'fixture',userId:user.id,organizationId:org.id,role:'OWNER',allBranches:true,branchAccess:[]};actor=owner;activeBranch=a.id;
    const product=await db.product.create({data:{organizationId:org.id,name:'Coffee',price:100,isSellable:true}});
    await db.branchStock.create({data:{organizationId:org.id,branchId:a.id,productId:product.id,quantity:10,criticalLevel:3}});
    for(const branch of [a,b]) for(const type of ['CASH','CARD']) await db.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:type,type,openingBalance:1000}});
    Module._load=function(request,parent,main){
      if(request==='@/lib/prisma')return {prisma:db};
      if(request==='@/lib/current-membership')return {getCurrentMembership:async()=>require('../src/lib/auth-context.ts').membershipContext.getStore()??actor};
      if(request==='next/headers')return {cookies:async()=>({get:()=>({value:activeBranch})})};
      if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));
      return load.call(this,request,parent,main);
    };
    const orgApi=require('../src/app/api/settings/organization/route.ts'), branchApi=require('../src/app/api/settings/branches/[branchId]/route.ts'), orders=require('../src/app/api/orders/route.ts'), refunds=require('../src/app/api/orders/[id]/refund/route.ts'), printers=require('../src/app/api/integrations/printer/[branchId]/route.ts'), stockApi=require('../src/app/api/stock/route.ts'), qr=require('../src/lib/qr-service.ts'), alerts=require('../src/lib/stock-alerts.ts'), checkout=require('../src/app/api/restaurant/tabs/[id]/checkout/route.ts');
    Module._load=load;
    const {defaultBranchSettings:defaults,settingSections,businessFields}=require('../src/lib/settings.ts');
    const request=(method,url,body,origin='http://localhost')=>new Request('http://localhost'+url,{method,headers:{origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const ctx=id=>({params:Promise.resolve({branchId:id,id})});
    const expect=async(r,status)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
    const get=id=>branchApi.GET(request('GET','/api/settings/branches/'+id),ctx(id));
    const save=(section,values={},id=a.id,origin)=>branchApi.PATCH(request('PATCH','/api/settings/branches/'+id,{section,settings:Object.fromEntries(settingSections[section].map(k=>[k,k in values?values[k]:defaults[k]]))},origin),ctx(id));
    const sale=(values={})=>orders.POST(request('POST','/api/orders',{idempotencyKey:crypto.randomUUID(),branchId:activeBranch,paymentMethod:'CASH',items:[{productId:product.id,quantity:1}],...values}));
    const refund=(id,reason)=>refunds.POST(request('POST','/api/orders/'+id+'/refund',reason===undefined?{}:{reason}),{params:Promise.resolve({id})});
    let oldOrder,newOrder;
    await t.test('1,10: business validation, persistence and fixed TRY contract',async()=>{
      const before=(await expect(await orgApi.GET(),200)).business;
      assert.equal(before.name,'Original business'); assert.equal(before.taxNumber,'');
      await expect(await orgApi.PATCH(request('PATCH','/api/settings/organization',{...before,email:'bad'})),400);
      await expect(await orgApi.PATCH(request('PATCH','/api/settings/organization',{...before,taxNumber:'123'})),400);
      await expect(await orgApi.PATCH(request('PATCH','/api/settings/organization',{...before,currency:'USD'})),400);
      await expect(await orgApi.PATCH(request('PATCH','/api/settings/organization',{...before,legalName:'Original trading',taxNumber:'1234567890',phone:'+90 555 123 4567'})),200);
      assert.equal((await expect(await orgApi.GET(),200)).business.legalName,'Original trading');
    });
    await t.test('2: branch persistence and independent safe defaults',async()=>{
      await expect(await save('pos',{defaultPaymentMethod:'CARD',maxDiscountPercent:10}),200);
      assert.equal((await expect(await get(a.id),200)).settings.maxDiscountPercent,10);
      assert.equal((await expect(await get(b.id),200)).settings.maxDiscountPercent,100);
      assert.equal((await expect(await get(b.id),200)).settings.allowNegativeStock,false);
    });
    await t.test('3: percentage and fixed discounts enforced by actual POS API without partial writes',async()=>{
      const count=await db.order.count({where:{organizationId:org.id}});
      await expect(await sale({discount:{type:'PERCENT',value:11}}),400);
      await expect(await sale({discount:{type:'FIXED',value:11}}),400);
      assert.equal(await db.order.count({where:{organizationId:org.id}}),count);
      oldOrder=(await expect(await sale({discount:{type:'PERCENT',value:10}}),201)).order;
      assert.equal(oldOrder.total,'90');assert.equal(oldOrder.businessSnapshot.name,'Original business');
      await expect(await save('pos',{discountRoles:[],maxDiscountPercent:100}),200);
      await expect(await sale({discount:{type:'PERCENT',value:1}}),403);
    });
    await t.test('4: refund role restriction and required reason enforced before state changes',async()=>{
      await expect(await save('pos',{refundRoles:[],refundReasonRequired:true}),200);
      await expect(await refund(oldOrder.id,'valid reason'),403);
      await expect(await save('pos',{refundReasonRequired:true}),200);
      await expect(await refund(oldOrder.id),400);
      assert.equal((await db.order.findUnique({where:{id:oldOrder.id}})).status,'COMPLETED');
      await expect(await refund(oldOrder.id,'Customer returned the product'),200);
      const audit=await db.auditLog.findFirst({where:{entityId:oldOrder.id,action:'orders.refund'}});assert.equal(audit.metadata.reason,'Customer returned the product');
    });
    await t.test('5: negative stock disabled, concurrent sales cannot oversell',async()=>{
      await db.branchStock.update({where:{branchId_productId:{branchId:a.id,productId:product.id}},data:{quantity:1}});
      await expect(await save('stock',{allowNegativeStock:false}),200);
      const responses=await Promise.all([sale(),sale()]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
      assert.equal((await db.branchStock.findUnique({where:{branchId_productId:{branchId:a.id,productId:product.id}}})).quantity.toString(),'0');
    });
    await t.test('6: negative stock enabled uses atomic increments, including missing branch stock',async()=>{
      activeBranch=b.id;await expect(await save('stock',{allowNegativeStock:true,defaultCriticalLevel:'4.5'},b.id),200);
      const responses=await Promise.all([sale(),sale()]);for(const r of responses)await expect(r,201);
      const stock=await db.branchStock.findUnique({where:{branchId_productId:{branchId:b.id,productId:product.id}}});assert.equal(stock.quantity.toString(),'-2');assert.equal(stock.criticalLevel.toString(),'4.5');activeBranch=a.id;
    });
    await t.test('7: real critical alerts obey product threshold and notification switches',async()=>{
      await expect(await save('stock',{criticalStockEnabled:true,defaultCriticalLevel:'99'}),200);
      let result=await alerts.criticalStockAlerts();assert(result.enabled);assert(result.rows.some(r=>r.name==='Coffee'&&r.criticalLevel==='3'));
      await expect(await save('notifications',{criticalStockNotification:false}),200);result=await alerts.criticalStockAlerts();assert.equal(result.enabled,false);
      await expect(await save('notifications'),200);
    });
    await t.test('8: printer settings share the exact existing integration API and storage',async()=>{
      const current=(await expect(await printers.GET(request('GET','/api/integrations/printer/'+a.id),ctx(a.id)),200)).settings;
      await expect(await printers.PATCH(request('PATCH','/api/integrations/printer/'+a.id,{...current,paperWidth:'58',showOrganization:false}),ctx(a.id)),200);
      assert.equal((await db.branchPrinterSetting.findUnique({where:{branchId:a.id}})).showOrganization,false);
      assert.equal((await expect(await printers.GET(request('GET','/api/integrations/printer/'+a.id),ctx(a.id)),200)).settings.paperWidth,'58');
    });
    await t.test('9: QR requests preserved while branch notification types filter latest alert',async()=>{
      const table=await db.restaurantTable.create({data:{organizationId:org.id,branchId:a.id,name:'Table'}});
      await db.serviceRequest.create({data:{organizationId:org.id,branchId:a.id,tableId:table.id,type:'WAITER_CALL'}});
      await expect(await save('notifications',{waiterNotification:false}),200);
      let result=await qr.listServiceRequests(request('GET','/api/restaurant/service-requests?branchId='+a.id));assert.equal(result.latestId,null);assert.equal(result.rows.length,1);
      await expect(await save('notifications',{notificationsEnabled:false}),200);result=await qr.listServiceRequests(request('GET','/api/restaurant/service-requests?branchId='+a.id));assert.equal(result.notificationPolicy.enabled,false);assert.equal(result.rows.length,1);
      await expect(await save('notifications'),200);
    });
    await t.test('11,12: tenant, assigned branch, role, unknown fields and origin controls',async()=>{
      await expect(await get(c.id),404);await expect(await save('pos',{},c.id),404);
      actor={...owner,role:'ADMIN',allBranches:false,branchAccess:[{branchId:a.id}]};await expect(await save('pos',{},b.id),404);
      await expect(await orgApi.GET(),403);
      actor={...owner,role:'MANAGER',allBranches:false,branchAccess:[{branchId:a.id}]};await expect(await save('pos'),403);await expect(await save('stock'),403);await expect(await save('notifications'),200);await expect(await orgApi.GET(),403);
      actor={...owner,role:'CASHIER'};await expect(await save('notifications'),403);
      actor=owner;await expect(await save('pos',{},a.id,'https://foreign.test'),403);
      await expect(await branchApi.PATCH(request('PATCH','/api/settings/branches/'+a.id,{section:'stock',settings:{allowNegativeStock:true,criticalStockEnabled:true,defaultCriticalLevel:'0',organizationId:foreign.id}}),ctx(a.id)),400);
    });
    await t.test('14: changing business info preserves existing snapshots and freezes legacy receipt identity',async()=>{
      await db.branchStock.update({where:{branchId_productId:{branchId:a.id,productId:product.id}},data:{quantity:10}});
      newOrder=(await expect(await sale(),201)).order;
      const legacy=await db.order.create({data:{organizationId:org.id,branchId:a.id,orderNumber:'legacy-'+seed,paymentMethod:'CASH',subtotal:1,total:1}});
      const info=(await expect(await orgApi.GET(),200)).business;
      const businessCounts=await Promise.all([db.financeTransaction.count(),db.stockMovement.count()]);
      await expect(await orgApi.PATCH(request('PATCH','/api/settings/organization',{...info,name:'Renamed business',taxNumber:'9876543210'})),200);
      assert.equal((await db.order.findUnique({where:{id:newOrder.id}})).businessSnapshot.name,'Original business');
      assert.equal((await db.order.findUnique({where:{id:legacy.id}})).businessSnapshot.name,'Original business');
      assert.equal((await db.order.findUnique({where:{id:newOrder.id}})).total.toString(),'100');
      assert.deepEqual(await Promise.all([db.financeTransaction.count(),db.stockMovement.count()]),businessCounts);
      const after=(await expect(await sale(),201)).order;assert.equal(after.businessSnapshot.name,'Renamed business');
      assert.equal((await db.branch.findUnique({where:{id:a.id}})).name,'A');
    });
    await t.test('15: critical changes audit actor, scope, changed fields without copying private values',async()=>{
      const audits=await db.auditLog.findMany({where:{organizationId:org.id,action:{in:['ORGANIZATION_SETTINGS_UPDATED','BRANCH_SETTINGS_UPDATED']}}});
      assert(audits.some(a=>a.metadata.changedFields.includes('taxNumber')));assert(audits.some(a=>a.metadata.changedFields.includes('allowNegativeStock')));assert(audits.some(a=>a.metadata.changedFields.includes('maxDiscountPercent')));assert(audits.some(a=>a.metadata.changedFields.includes('refundReasonRequired')));
      for(const a of audits){assert.equal(a.actorUserId,user.id);assert(a.createdAt);assert(!JSON.stringify(a.metadata).includes('9876543210'));}
    });
    await t.test('customer requirement is deliberate, API enforced and can return to anonymous defaults',async()=>{
      await expect(await save('pos',{customerSelection:'REQUIRED'}),200);await expect(await sale(),400);
      await expect(await save('pos',{customerSelection:'HIDDEN'}),200);await expect(await sale(),201);
      await expect(await save('pos'),200);
    });
    await t.test('general threshold initializes new stocks, preserving existing product overrides',async()=>{
      const p=await db.product.create({data:{organizationId:org.id,name:'New stock',price:10}});
      await expect(await stockApi.POST(request('POST','/api/stock',{idempotencyKey:crypto.randomUUID(),branchId:a.id,productId:p.id,quantity:'5'})),201);
      assert.equal((await db.branchStock.findUnique({where:{branchId_productId:{branchId:a.id,productId:p.id}}})).criticalLevel.toString(),'99');
      assert.equal((await db.branchStock.findUnique({where:{branchId_productId:{branchId:a.id,productId:product.id}}})).criticalLevel.toString(),'3');
    });
    await t.test('restaurant checkout shares negative stock policy and records business snapshot',async()=>{
      const table=await db.restaurantTable.create({data:{organizationId:org.id,branchId:a.id,name:'Checkout policy'}});
      const makeTab=()=>db.tab.create({data:{organizationId:org.id,branchId:a.id,tableId:table.id,tabNumber:'TAB-'+crypto.randomUUID(),items:{create:{productId:product.id,productName:product.name,quantity:1,unitPrice:100,total:100}}}});
      await db.branchStock.update({where:{branchId_productId:{branchId:a.id,productId:product.id}},data:{quantity:0}});
      await expect(await save('stock',{allowNegativeStock:false}),200);
      const tab=await makeTab();const call=()=>checkout.POST(request('POST','/api/restaurant/tabs/'+tab.id+'/checkout',{paymentMethod:'CASH'}),{params:Promise.resolve({id:tab.id})});
      await expect(await call(),409);assert.equal((await db.tab.findUnique({where:{id:tab.id}})).status,'OPEN');
      await expect(await save('stock',{allowNegativeStock:true}),200);const result=await expect(await call(),200);
      const order=await db.order.findUnique({where:{id:result.orderId}});assert.equal(order.businessSnapshot.name,'Renamed business');
      assert.equal((await db.branchStock.findUnique({where:{branchId_productId:{branchId:a.id,productId:product.id}}})).quantity.toString(),'-1');
    });
    await t.test('missing settings schema uses safe defaults and prevents configuration writes',async()=>{
      await db.$executeRawUnsafe('ALTER TABLE "BranchSettings" RENAME TO "BranchSettings_test_hidden"');
      try {const body=await expect(await get(a.id),200);assert.equal(body.storageReady,false);assert.equal(body.settings.allowNegativeStock,false);await expect(await save('stock'),503);}
      finally{await db.$executeRawUnsafe('ALTER TABLE "BranchSettings_test_hidden" RENAME TO "BranchSettings"');}
    });
    assert(Object.keys(businessFields).length>0);assert(Prisma.DbNull);
  } finally {Module._load=load;await db.$disconnect();}
});
