/* eslint-disable @typescript-eslint/no-require-imports -- Application read-only smoke check; no fixtures or auth credentials are created. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
require('dotenv').config({quiet:true});
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.url',JSON.stringify(require('node:url').pathToFileURL(f).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {PrismaClient}=require('../src/generated/prisma/client.ts'),{PrismaPg}=require('@prisma/adapter-pg'),{NextRequest}=require('next/server');
async function main(){
  const url=new URL(process.env.DATABASE_URL);if(!url.hostname.endsWith('.neon.tech'))throw Error('Expected configured Neon source');url.searchParams.set('sslmode','verify-full');
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})}),load=Module._load;
  try{
    const actor=await db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return tx.membership.findFirst({where:{isActive:true,role:'OWNER'},include:{branchAccess:{where:{isActive:true},select:{branchId:true}}}});});
    if(!actor)throw Error('No active owner membership available for read-only service check');
    Module._load=function(request,parent,main){if(request==='@/lib/prisma')return {prisma:db};if(request==='@/lib/current-membership')return {getCurrentMembership:async()=>actor};if(request.startsWith('@/'))request=path.resolve(__dirname,'../src',request.slice(2));return load.call(this,request,parent,main);};
    const {loadReport}=require('../src/lib/report-service.ts');Module._load=load;
    const reports=[];
    for(const key of ['overview','sales','finance','stock','profit','customers','suppliers','branches']){
      const start=Date.now(),result=await loadReport(new NextRequest('http://localhost/api/reports?report='+key+'&preset=last7'));
      if(result.key!==key)throw Error('Wrong report returned');
      reports.push({key,status:'PASS',tableCount:result.tables.length,elapsedMs:Date.now()-start});
    }
    const result={verifiedAt:new Date().toISOString(),readOnly:true,liveFixturesCreated:false,financialValuesLogged:false,reports};
    fs.writeFileSync(path.join(__dirname,'../docs/reports-live-readonly.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{Module._load=load;await db.$disconnect();}
}
main().catch(error=>{console.error('REPORTS_READONLY_CHECK_FAILED',error.code||error.name);process.exitCode=1;});
