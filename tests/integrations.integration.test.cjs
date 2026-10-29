/* eslint-disable @typescript-eslint/no-require-imports -- Local PostgreSQL API isolation tests. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('printer settings: real local DB, RBAC, tenant isolation and safe responses', { skip: process.env.WELLPOS_INTEGRATIONS_DB_TEST !== '1', timeout: 120000 }, async t => {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Never run fixtures against Neon');
  require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
  const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const load = Module._load; let actor;
  try {
    const seed = crypto.randomUUID();
    const org = await db.organization.create({ data: { name: 'Printer test', slug: 'printer-' + seed } });
    const foreign = await db.organization.create({ data: { name: 'Other', slug: 'foreign-printer-' + seed } });
    const user = await db.user.create({ data: { email: seed + '@printer.test' } });
    const a = await db.branch.create({ data: { organizationId: org.id, name: 'A' } }), b = await db.branch.create({ data: { organizationId: org.id, name: 'B' } }), c = await db.branch.create({ data: { organizationId: foreign.id, name: 'C' } });
    const owner = { id: 'fixture', userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] }; actor = owner;
    Module._load = function(request, parent, main) {
      if (request === '@/lib/prisma') return { prisma: db };
      if (request === '@/lib/current-membership') return { getCurrentMembership: async () => require('../src/lib/auth-context.ts').membershipContext.getStore() ?? actor };
      if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
      return load.call(this, request, parent, main);
    };
    const api = require('../src/app/api/integrations/printer/[branchId]/route.ts'); Module._load = load;
    const defaults = require('../src/lib/integrations.ts').defaultPrinterSettings;
    const call = (method, id, body, origin = 'http://localhost') => api[method](new Request('http://localhost/api/integrations/printer/' + id, { method, headers: { origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ branchId: id }) });
    const expect = async (r, status) => { assert.equal(r.status, status, await r.clone().text()); return r.json(); };
    await t.test('defaults, 58/80 mm and independent persistent branch settings', async () => {
      assert.deepEqual((await expect(await call('GET', a.id), 200)).settings, defaults);
      await expect(await call('PATCH', a.id, { ...defaults, paperWidth: '58', receiptHeader: 'A header', afterSalePrint: 'OPEN_DIALOG' }), 200);
      await expect(await call('PATCH', b.id, { ...defaults, paperWidth: '80', receiptFooter: 'B footer' }), 200);
      const result = await expect(await call('GET', a.id), 200); assert.equal(result.settings.paperWidth, '58'); assert.equal(result.settings.receiptHeader, 'A header');
      assert.equal((await expect(await call('GET', b.id), 200)).settings.receiptFooter, 'B footer');
      const audit = await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'PRINTER_SETTINGS_UPDATED' } }); assert(audit); assert.equal(audit.metadata, null);
    });
    await t.test('foreign organization rejected on read/write, including injected organization ID', async () => {
      await expect(await call('GET', c.id), 404); await expect(await call('PATCH', c.id, defaults), 404);
      await expect(await call('PATCH', a.id, { ...defaults, organizationId: foreign.id }), 400);
    });
    await t.test('branch restricted ADMIN can write only authorized branch', async () => {
      actor = { ...owner, role: 'ADMIN', allBranches: false, branchAccess: [{ branchId: a.id }] };
      await expect(await call('PATCH', a.id, defaults), 200); await expect(await call('PATCH', b.id, defaults), 404); await expect(await call('GET', b.id), 404);
    });
    await t.test('cashier may read operational settings but cannot write; staff cannot read', async () => {
      actor = { ...owner, role: 'CASHIER', allBranches: false, branchAccess: [{ branchId: a.id }] };
      const r = await call('GET', a.id); assert.match(r.headers.get('cache-control'), /no-store/); await expect(r, 200);
      await expect(await call('PATCH', a.id, defaults), 403); await expect(await call('GET', b.id), 404);
      actor = { ...owner, role: 'STAFF' }; await expect(await call('GET', a.id), 403);
    });
    await t.test('reject secrets, invalid widths and cross origin requests; responses contain public settings only', async () => {
      actor = owner;
      for (const bad of [{ ...defaults, apiKey: 'do-not-store' }, { ...defaults, paperWidth: '99' }]) await expect(await call('PATCH', a.id, bad), 400);
      await expect(await call('PATCH', a.id, defaults, 'https://foreign.test'), 403);
      const body = await expect(await call('GET', a.id), 200); assert.deepEqual(Object.keys(body).sort(), ['settings', 'storageReady']); assert.deepEqual(Object.keys(body.settings).sort(), Object.keys(defaults).sort());
      assert.equal(await db.branchPrinterSetting.count({ where: { organizationId: foreign.id } }), 0);
    });
    await t.test('composite database foreign key rejects mismatched organization/branch', async () => {
      await assert.rejects(db.branchPrinterSetting.create({ data: { branchId: c.id, organizationId: org.id } }));
    });
    await t.test('missing migration preserves POS defaults and returns 503 for writes', async () => {
      await db.$executeRawUnsafe('ALTER TABLE "BranchPrinterSetting" RENAME TO "BranchPrinterSetting_test_hidden"');
      try {
        const body = await expect(await call('GET', a.id), 200); assert.equal(body.storageReady, false); assert.deepEqual(body.settings, defaults);
        await expect(await call('PATCH', a.id, defaults), 503);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "BranchPrinterSetting_test_hidden" RENAME TO "BranchPrinterSetting"'); }
    });
  } finally { Module._load = load; await db.$disconnect(); }
});
