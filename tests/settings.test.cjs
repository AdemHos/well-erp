/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free TypeScript and actual component tests. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(f).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {defaultBranchSettings,parseSection,parseBusinessInfo,businessFields,settingSections}=require('../src/lib/settings.ts');
const {hasPermission}=require('../src/lib/permissions.ts');
test('safe defaults preserve anonymous sales, discount/refund roles and nonnegative inventory',()=>{
  assert.equal(defaultBranchSettings.customerSelection,'OPTIONAL');assert.equal(defaultBranchSettings.allowNegativeStock,false);assert.equal(defaultBranchSettings.maxDiscountPercent,100);assert.equal(defaultBranchSettings.refundReasonRequired,false);assert.equal(defaultBranchSettings.defaultPaymentMethod,'CASH');
  assert.deepEqual(defaultBranchSettings.refundRoles,['OWNER','ADMIN','MANAGER']);
});
test('section validators reject unknown fields, excessive limits and RBAC escalation',()=>{
  const pos=Object.fromEntries(settingSections.pos.map(k=>[k,defaultBranchSettings[k]]));
  assert.equal(parseSection('pos',{...pos,maxDiscountPercent:10}).maxDiscountPercent,10);
  for(const bad of [{...pos,maxDiscountPercent:101},{...pos,maxDiscountPercent:1.5},{...pos,refundRoles:['CASHIER']},{...pos,discountRoles:['WAITER']},{...pos,token:'secret'},{...pos,customerSelection:'AUTO'}])assert.throws(()=>parseSection('pos',bad));
  for(const value of ['-1','NaN','1.0001','1e3'])assert.throws(()=>parseSection('stock',{allowNegativeStock:false,criticalStockEnabled:true,defaultCriticalLevel:value}));
  assert.throws(()=>parseSection('notifications',{notificationsEnabled:'false'}));
});
test('business contact and tax fields validate server-side; unsafe logo/URLs are rejected',()=>{
  const info=Object.fromEntries(Object.keys(businessFields).map(k=>[k,k==='name'?'Cafe':'']));
  assert.equal(parseBusinessInfo({...info,name:' Cafe '}).name,'Cafe');
  for(const bad of [{...info,name:''},{...info,email:'bad'},{...info,taxNumber:'123'},{...info,website:'javascript:alert(1)'},{...info,logoUrl:'https://foreign.test/logo.svg'},{...info,password:'secret'}])assert.throws(()=>parseBusinessInfo(bad));
});
test('role permissions allow personal security screen without granting policy changes',()=>{
  for(const role of ['OWNER','ADMIN','MANAGER','CASHIER','WAITER','KITCHEN','STAFF'])assert(hasPermission(role,'settings.read'));
  for(const role of ['MANAGER','CASHIER','WAITER','KITCHEN','STAFF'])assert.equal(hasPermission(role,'settings.policy.manage'),false);
  assert(hasPermission('MANAGER','settings.branch.manage'));assert.equal(hasPermission('MANAGER','settings.organization.manage'),false);
});
test('OAuth-only actual settings screen does not expose local password or nonfunctional session actions',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),original=Module._load;
  Module._load=function(request,parent,main){
    if(request==='@/lib/uploadthing')return {UploadButton:()=>null};
    if(request==='@/components/landing/auth/LogoutButton')return {__esModule:true,default:()=>React.createElement('button',null,'Çıkış Yap')};
    if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));
    return original.call(this,request,parent,main);
  };
  let Component;try{Component=require('../src/components/settings/SettingsManager.tsx').default;}finally{Module._load=original;}
  const security={name:'OAuth user',email:'test@example.test',providers:['google'],hasLocalPassword:false,role:'CASHIER',permissions:['pos.sell'],signedInAt:null,expires:null,profileActive:false};
  const html=renderToStaticMarkup(React.createElement(Component,{organizationName:'Cafe',branches:[],canBusiness:false,canPolicy:false,canBranch:false,canPrinter:false,canQr:false,security}));
  assert(html.includes('OAuth hesabınızın şifresi sağlayıcınız tarafından yönetilir.'));assert(html.includes('google'));assert(!html.includes('Yerel şifre</dd>'));assert(html.includes('Çıkış Yap'));assert(!html.includes('type="password"'));assert(!html.includes('deviceSessionId'));assert(html.includes('JWT tabanlıdır'));
});
test('actual settings form saves only its section and aborts old scope reads',async()=>{
  const filename=path.resolve(__dirname,'../src/components/settings/SettingsForm.tsx'),original=Module._load,slots=[],effects=[];
  let cursor=0,scheduled=[];
  const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++,before=effects[i];if(!before||deps.some((d,j)=>!Object.is(d,before.deps[j])))scheduled.push(()=>{before?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  Module._load=function(request,parent,main){if(request==='react'&&parent.filename===filename)return hooks;if(request==='@/lib/settings')return require('../src/lib/settings.ts');return original.call(this,request,parent,main);};
  let Form;try{delete require.cache[filename];Form=require(filename).SettingsForm;}finally{Module._load=original;}
  const oldFetch=global.fetch,calls=[],pending=[];let dirty=false;
  global.fetch=(url,options)=>{calls.push({url,options});return new Promise(resolve=>pending.push(resolve));};
  const changes=[];let current;
  const base={title:'POS',scope:'Şube',endpoint:'/api/settings/branches/A',property:'settings',section:'pos',canEdit:true,onDirty:v=>{dirty=v;},children:(v,change)=>{current=v;changes[0]=change;return null;}};
  const render=props=>{cursor=0;scheduled=[];const tree=Form(props);scheduled.forEach(f=>f());return tree;};
  const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
  const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
  try{
    render(base);const signal=calls[0].options.signal;
    const b={...base,endpoint:'/api/settings/branches/B'};render(b);assert(signal.aborted);
    pending[0]({ok:true,json:async()=>({settings:{...defaultBranchSettings,maxDiscountPercent:99},storageReady:true})});await flush();assert.equal(slots[0],null);
    pending[1]({ok:true,json:async()=>({settings:defaultBranchSettings,storageReady:true})});await flush();render(b);assert.equal(current.maxDiscountPercent,100);
    changes[0]('maxDiscountPercent',10);let tree=render(b);assert(dirty);
    const save=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Kaydet');assert(!save.props.disabled);save.props.onClick();
    const body=JSON.parse(calls[2].options.body);assert.equal(body.section,'pos');assert.equal(body.settings.maxDiscountPercent,10);assert.equal(body.settings.allowNegativeStock,undefined);
    pending[2]({ok:true,json:async()=>({settings:{...defaultBranchSettings,maxDiscountPercent:10},storageReady:true})});await flush();render(b);assert.equal(dirty,false);
  }finally{effects.forEach(e=>e?.cleanup?.());global.fetch=oldFetch;}
});
