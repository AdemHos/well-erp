/* eslint-disable @typescript-eslint/no-require-imports -- Read-only live service smoke check; no tokens, fixtures or sessions created. */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require('dotenv').config({ quiet: true });
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg');
async function main() {
  const url = new URL(process.env.DATABASE_URL); if (!url.hostname.endsWith('.neon.tech')) throw Error('Expected configured Neon'); url.searchParams.set('sslmode', 'verify-full');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) }), load = Module._load;
  let client, actor;
  try {
    Module._load = function(request, parent, main) {
      if (request === '@/lib/prisma') return { prisma: new Proxy({}, { get(_target, key) { if (!client) throw Error('No read-only transaction'); if (key === '$transaction') return async work => { if (!Array.isArray(work)) throw Error('Only read batches allowed'); const values = []; for (const query of work) values.push(await query); return values; }; const value = client[key]; return typeof value === 'function' ? value.bind(client) : value; } }) };
      if (request === '@/lib/current-membership') return { getCurrentMembership: async () => actor };
      if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
      return load.call(this, request, parent, main);
    };
    const service = require('../src/lib/qr-service.ts'); Module._load = load;
    const checks = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '10000'`;
      client = tx;
      actor = await tx.membership.findFirst({ where: { isActive: true, role: 'OWNER' }, include: { branchAccess: { where: { isActive: true }, select: { branchId: true } } } });
      if (!actor) throw Error('Active owner required for read-only check');
      const branches = await tx.branch.findMany({ where: { organizationId: actor.organizationId }, select: { id: true }, take: 100 });
      if (!branches.length) throw Error('An existing branch is required');
      for (const branch of branches) {
        const settings = await service.getQrSettings(branch.id);
        if (!Array.isArray(settings.tables)) throw Error('QR settings read failed');
        const requests = await service.listServiceRequests(new Request('http://localhost/api/restaurant/service-requests?branchId=' + branch.id));
        const history = await service.listServiceRequests(new Request('http://localhost/api/restaurant/service-requests?branchId=' + branch.id + '&history=true'));
        if (!Array.isArray(requests.rows) || !Array.isArray(history.rows)) throw Error('Request list read failed');
        // Exercise original table/tab read shape without exposing internal token data.
        await tx.restaurantTable.findMany({ where: { organizationId: actor.organizationId, branchId: branch.id }, select: { id: true, name: true, isActive: true, tabs: { where: { status: 'OPEN' }, select: { id: true, total: true }, take: 1 } }, take: 10 });
      }
      try { await service.publicMenu('X'.repeat(43)); throw Error('Unknown public token accepted'); } catch (e) { if (e.status !== 404) throw e; }
      return { branchCount: branches.length, settingsRead: 'PASS', openRequestsRead: 'PASS', requestHistoryRead: 'PASS', existingTableTabRead: 'PASS', invalidPublicTokenRejected: 'PASS' };
    }, { timeout: 30000, maxWait: 5000 });
    const result = { verifiedAt: new Date().toISOString(), readOnly: true, liveFixturesCreated: false, tokensOrBusinessValuesLogged: false, ...checks };
    fs.writeFileSync(path.join(__dirname, '../docs/qr-service-live-readonly.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { Module._load = load; client = null; await db.$disconnect(); }
}
main().catch(e => { console.error('QR_READONLY_CHECK_FAILED', e.code || e.name); process.exitCode = 1; });
