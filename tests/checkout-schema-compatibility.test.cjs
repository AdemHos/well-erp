/* eslint-disable @typescript-eslint/no-require-imports -- Real localhost checkout, run before and after the customer migration. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('restaurant checkout preserves anonymous order and stock before/after customer migration', { skip: process.env.WELLPOS_CUSTOMERS_DB_TEST !== '1', timeout: 120000 }, async () => {
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
  require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(f).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
  const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}), load=Module._load, rollback=new Error('ROLLBACK_CHECKOUT_FIXTURE');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const seed=crypto.randomUUID(), org=await tx.organization.create({data:{name:'Checkout',slug:'checkout-'+seed}}), user=await tx.user.create({data:{email:seed+'@example.test'}}), branch=await tx.branch.create({data:{organizationId:org.id,name:'A'}});
      const table=await tx.restaurantTable.create({data:{organizationId:org.id,branchId:branch.id,name:'Table'}}), product=await tx.product.create({data:{organizationId:org.id,name:'Checkout item',price:100}});
      await tx.financeAccount.create({data:{organizationId:org.id,branchId:branch.id,name:'Cash',type:'CASH'}});
      await tx.branchStock.create({data:{organizationId:org.id,branchId:branch.id,productId:product.id,quantity:10}});
      const tab=await tx.tab.create({data:{organizationId:org.id,branchId:branch.id,tableId:table.id,tabNumber:seed,items:{create:{productId:product.id,productName:product.name,quantity:2,unitPrice:100,total:200}}}});
      const actor={userId:user.id,organizationId:org.id,role:'OWNER',allBranches:true,branchAccess:[]};
      const client=new Proxy(tx,{get(target,key){return key==='$transaction'?async work=>work(tx):Reflect.get(target,key,target);}});
      Module._load=function(request,parent,main){if(request==='@/lib/prisma')return{prisma:client};if(request==='@/lib/current-membership')return{getCurrentMembership:async()=>actor};if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));return load.call(this,request,parent,main);};
      const {POST}=require('../src/app/api/restaurant/tabs/[id]/checkout/route.ts');Module._load=load;
      const r=await POST(new NextRequest('http://localhost/api/restaurant/tabs/'+tab.id+'/checkout',{method:'POST',body:JSON.stringify({paymentMethod:'CASH'})}),{params:Promise.resolve({id:tab.id})});assert.equal(r.status,200,await r.clone().text());
      const order=await tx.order.findFirstOrThrow({where:{organizationId:org.id},omit:{customerId:true,customerSnapshot:true}});assert(order.total.eq(200));assert.equal(order.paymentMethod,'CASH');assert((await tx.branchStock.findUnique({where:{branchId_productId:{branchId:branch.id,productId:product.id}}})).quantity.eq(8));assert.equal((await tx.tab.findUnique({where:{id:tab.id}})).status,'CLOSED');
      throw rollback;
    },{timeout:110000}),e=>e===rollback);
  } finally {Module._load=load;await db.$disconnect();}
});
