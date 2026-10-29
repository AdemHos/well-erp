/* eslint-disable @typescript-eslint/no-require-imports -- Real PostgreSQL integration; localhost fixtures only. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
test('QR menu service requests: real local DB and API isolation', { skip: process.env.WELLPOS_QR_DB_TEST !== '1', timeout: 180000 }, async t => {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Fixtures must never reach Neon');
  for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(f).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
  const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg'), { NextRequest } = require('next/server');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }), load = Module._load;
  let actor;
  try {
    const seed = crypto.randomUUID(), org = await db.organization.create({ data: { name: 'QR fixture', slug: 'qr-' + seed } }), otherOrg = await db.organization.create({ data: { name: 'Other QR', slug: 'other-qr-' + seed } });
    const branch = await db.branch.create({ data: { organizationId: org.id, name: 'Main' } }), b = await db.branch.create({ data: { organizationId: org.id, name: 'Other branch' } }), foreign = await db.branch.create({ data: { organizationId: otherOrg.id, name: 'Foreign' } });
    const user = await db.user.create({ data: { email: 'qr-' + seed + '@example.test', name: 'Owner' } }), waiter = await db.user.create({ data: { email: 'waiter-' + seed + '@example.test', name: 'Waiter' } });
    const profile = await db.staffProfile.create({ data: { organizationId: org.id, name: 'Waiter profile', role: 'WAITER' } });
    const owner = { id: 'fixture', userId: user.id, organizationId: org.id, role: 'OWNER', allBranches: true, branchAccess: [] }, waitActor = { ...owner, userId: waiter.id, role: 'WAITER', allBranches: false, profileId: profile.id, branchAccess: [{ branchId: branch.id }] };
    actor = owner;
    const table = await db.restaurantTable.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Masa 1' } }), table2 = await db.restaurantTable.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Masa 2' } });
    await db.product.create({ data: { organizationId: org.id, name: 'Coffee', price: 80, costPrice: 20 } });
    await db.product.create({ data: { organizationId: org.id, name: 'Raw ingredient', price: 0, isSellable: false } });
    await db.product.create({ data: { organizationId: otherOrg.id, name: 'Private foreign product', price: 900 } });
    Module._load = function(request, parent, main) {
      if (request === '@/lib/prisma') return { prisma: db };
      if (request === '@/lib/current-membership') return { getCurrentMembership: async () => require('../src/lib/auth-context.ts').membershipContext.getStore() ?? actor };
      if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
      return load.call(this, request, parent, main);
    };
    const settingsApi = require('../src/app/api/qr-menu/[branchId]/route.ts'), tokenApi = require('../src/app/api/qr-menu/[branchId]/tables/[tableId]/route.ts'), publicApi = require('../src/app/api/menu/[token]/requests/route.ts'), listApi = require('../src/app/api/restaurant/service-requests/route.ts'), updateApi = require('../src/app/api/restaurant/service-requests/[id]/route.ts');
    const service = require('../src/lib/qr-service.ts'); Module._load = load;
    const request = (method, url, body, origin = 'http://localhost') => new NextRequest('http://localhost' + url, { method, headers: { origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context = params => ({ params: Promise.resolve(params) });
    const expect = async (response, status) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
    const settings = { isPublished: true, serviceRequestsEnabled: true, waiterCallEnabled: true, billRequestEnabled: true };
    const save = (values = settings, id = branch.id) => settingsApi.PATCH(request('PATCH', '/api/qr-menu/' + id, values), context({ branchId: id }));
    let menuToken, tableToken, tab;
    const call = (type = 'WAITER_CALL', token = tableToken) => publicApi.POST(request('POST', `/api/menu/${menuToken}/requests`, { type, tableToken: token }), context({ token: menuToken }));
    const list = (id = branch.id, extra = '') => listApi.GET(request('GET', '/api/restaurant/service-requests?branchId=' + id + extra));
    const action = (id, value) => updateApi.PATCH(request('PATCH', '/api/restaurant/service-requests/' + id, { action: value }), context({ id }));
    const find = type => db.serviceRequest.findFirst({ where: { tableId: table.id, type, status: { in: ['PENDING', 'ACKNOWLEDGED'] } } });
    await t.test('1: table QR resolves to organization/branch/table; QR generated locally', async () => {
      const result = await expect(await save(), 200); menuToken = result.menuPath.split('/').pop();
      const qr = await expect(await tokenApi.POST(request('POST', '/api/qr-menu/' + branch.id), context({ branchId: branch.id, tableId: table.id })), 200);
      tableToken = new URL(qr.menuPath, 'http://localhost').searchParams.get('table');
      assert.equal(tableToken.length, 43); const saved = await db.restaurantTable.findUnique({ where: { id: table.id } }); assert.notEqual(saved.qrTokenHash, tableToken); assert.equal(saved.qrTokenHash, service.tokenHash(tableToken));
      const menu = await service.publicMenu(menuToken, tableToken); assert.equal(menu.tableName, 'Masa 1'); assert.equal(menu.waiterCallEnabled, true); assert.equal(menu.products.length, 1); assert.equal(menu.products[0].price, '80.00'); assert(!JSON.stringify(menu).includes('costPrice'));
      const png = await require('qrcode').toDataURL('http://localhost' + qr.menuPath); assert(png.startsWith('data:image/png;base64,'));
    });
    await t.test('2: branch-general menu contains no service buttons or private IDs', async () => {
      const menu = await service.publicMenu(menuToken); assert.equal(menu.tableName, null); assert.equal(menu.waiterCallEnabled, false); assert.equal(menu.billRequestEnabled, false); for (const key of ['organizationId', 'branchId', 'tableId', 'staff', 'tabs']) assert(!(key in menu));
    });
    await t.test('3: public waiter call persists one pending request without exposing staff/adisyon', async () => {
      const result = await expect(await call(), 201); assert.equal(result.existing, false); assert(!('id' in result)); const row = await find('WAITER_CALL'); assert.equal(row.status, 'PENDING'); assert.equal(row.organizationId, org.id); assert.equal(row.branchId, branch.id); assert.equal(row.tabId, null);
    });
    await t.test('4 and 13: personnel sees new requests through repeated no-store polling reads', async () => {
      actor = waitActor; const response = await list(); assert.match(response.headers.get('cache-control'), /no-store/); const result = await expect(response, 200); assert.equal(result.total, 1); assert.equal(result.rows[0].table.name, 'Masa 1'); assert.equal(result.rows[0].status, 'PENDING'); assert.equal(result.latestId, result.rows[0].id); actor = owner;
    });
    await t.test('5: concurrent claiming succeeds once; actual user/profile persisted; completion recorded', async () => {
      actor = waitActor; const row = await find('WAITER_CALL');
      const results = await Promise.all([action(row.id, 'ACKNOWLEDGE'), action(row.id, 'ACKNOWLEDGE')]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      let saved = await db.serviceRequest.findUnique({ where: { id: row.id } }); assert.equal(saved.acknowledgedByUserId, waiter.id); assert.equal(saved.acknowledgedByProfileId, profile.id);
      const otherProfile = await db.staffProfile.create({ data: { organizationId: org.id, name: 'Another waiter', role: 'WAITER' } }); actor = { ...waitActor, profileId: otherProfile.id }; await expect(await action(row.id, 'COMPLETE'), 403);
      actor = waitActor; await expect(await action(row.id, 'COMPLETE'), 200); saved = await db.serviceRequest.findUnique({ where: { id: row.id } }); assert.equal(saved.completedByProfileId, profile.id); assert.equal(saved.completedByUserId, waiter.id); assert(saved.completedAt); await expect(await action(row.id, 'COMPLETE'), 409); actor = owner;
    });
    await t.test('6: concurrent duplicate calls and cooldown cannot create extra open rows', async () => {
      await expect(await call(), 429);
      await db.serviceRequest.updateMany({ where: { tableId: table.id }, data: { createdAt: new Date(Date.now() - 60000) } });
      const results = await Promise.all(Array.from({ length: 10 }, () => call())); assert.equal(results.filter(r => r.status === 201).length, 1); assert.equal(results.filter(r => r.status === 200).length, 9); assert.equal(await db.serviceRequest.count({ where: { tableId: table.id, status: 'PENDING' } }), 1);
    });
    await t.test('7: bill requires an active tab and associates it', async () => {
      await expect(await call('BILL_REQUEST'), 409);
      tab = await db.tab.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table.id, tabNumber: 'QR-' + seed, total: 80, subtotal: 80 } });
      await expect(await call('BILL_REQUEST'), 201); assert.equal((await find('BILL_REQUEST')).tabId, tab.id);
    });
    await t.test('8 and 15: requests, state changes and menu reads never close tabs or affect financial/stock records', async () => {
      const counts = async () => Promise.all([db.order.count(), db.stockMovement.count(), db.financeTransaction.count(), db.payment.count(), db.currentAccountEntry.count(), db.invoice.count()]);
      const before = await counts(); const bill = await find('BILL_REQUEST'); await expect(await action(bill.id, 'ACKNOWLEDGE'), 200); await expect(await action(bill.id, 'COMPLETE'), 200); await service.publicMenu(menuToken, tableToken);
      assert.deepEqual(await counts(), before); const saved = await db.tab.findUnique({ where: { id: tab.id } }); assert.equal(saved.status, 'OPEN'); assert.equal(saved.total.toString(), '80'); assert.equal(saved.orderId, null);
    });
    await t.test('9: inactive table blocks posts and public buttons', async () => {
      await db.restaurantTable.update({ where: { id: table.id }, data: { isActive: false } }); await expect(await call(), 404); const menu = await service.publicMenu(menuToken, tableToken); assert.equal(menu.invalidTable, true); assert.equal(menu.waiterCallEnabled, false); await db.restaurantTable.update({ where: { id: table.id }, data: { isActive: true } });
    });
    await t.test('closed or replaced tabs never produce a misleading existing bill success', async () => {
      await db.serviceRequest.updateMany({ where: { tableId: table.id }, data: { createdAt: new Date(Date.now() - 60000) } });
      await db.restaurantTable.update({ where: { id: table.id }, data: { requestWindowCount: 0 } });
      await expect(await call('BILL_REQUEST'), 201);
      const oldBill = await find('BILL_REQUEST');
      await db.tab.update({ where: { id: tab.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await expect(await call('BILL_REQUEST'), 409);
      const newTab = await db.tab.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table.id, tabNumber: 'QR-new-' + seed } });
      await expect(await call('BILL_REQUEST'), 409);
      assert.equal((await db.serviceRequest.findUnique({ where: { id: oldBill.id } })).tabId, tab.id);
      await expect(await action(oldBill.id, 'CANCEL'), 200);
      assert.equal((await db.tab.findUnique({ where: { id: newTab.id } })).status, 'OPEN');
    });
    await t.test('10: invalid, rotated, revoked and cross-branch tokens rejected', async () => {
      await expect(await call('WAITER_CALL', 'invalid'), 404);
      const otherMenu = await expect(await save(settings, b.id), 200), otherToken = otherMenu.menuPath.split('/').pop(); await expect(await publicApi.POST(request('POST', '/api/menu/x/requests', { type: 'WAITER_CALL', tableToken }), context({ token: otherToken })), 404);
      const old = tableToken; const qr = await expect(await tokenApi.POST(request('POST', '/api/qr-menu/x'), context({ branchId: branch.id, tableId: table.id })), 200); tableToken = new URL(qr.menuPath, 'http://localhost').searchParams.get('table'); await expect(await call('WAITER_CALL', old), 404);
      await expect(await tokenApi.DELETE(request('DELETE', '/api/qr-menu/x'), context({ branchId: branch.id, tableId: table.id })), 200); await expect(await call(), 404);
      const renewed = await expect(await tokenApi.POST(request('POST', '/api/qr-menu/x'), context({ branchId: branch.id, tableId: table.id })), 200); tableToken = new URL(renewed.menuPath, 'http://localhost').searchParams.get('table');
    });
    await t.test('11: branch and organization isolation applies to API, updates and QR settings', async () => {
      actor = waitActor; await expect(await list(b.id), 404); await expect(await list(foreign.id), 404); await expect(await list(branch.id, '&organizationId=' + otherOrg.id), 400);
      await assert.rejects(service.qrBranch(waitActor, b.id), e => e.status === 404);
      actor = { ...owner, organizationId: otherOrg.id }; await expect(await action((await find('WAITER_CALL')).id, 'ACKNOWLEDGE'), 404); await expect(await settingsApi.GET(request('GET', '/api/qr-menu/' + branch.id), context({ branchId: branch.id })), 404); actor = owner;
    });
    await t.test('12: missing session and disallowed roles cannot read/manage requests or settings', async () => {
      const row = await find('WAITER_CALL'); actor = null; await expect(await list(), 401);
      actor = { ...owner, role: 'STAFF' }; await expect(await list(), 403); await expect(await action(row.id, 'ACKNOWLEDGE'), 403);
      actor = { ...owner, role: 'CASHIER' }; await expect(await list(), 200); await expect(await action(row.id, 'ACKNOWLEDGE'), 403); await expect(await save(), 403);
      await assert.rejects(service.changeServiceRequest(row.id, { action: 'ACKNOWLEDGE' }), e => e.status === 403);
      actor = waitActor; await expect(await save(), 403); actor = owner;
    });
    await t.test('14: branch setting switches hide buttons and prevent forged direct calls', async () => {
      for (const key of ['waiterCallEnabled', 'serviceRequestsEnabled', 'isPublished']) {
        await expect(await save({ ...settings, [key]: false }), 200); await expect(await call(), 404); if (key !== 'isPublished') assert.equal((await service.publicMenu(menuToken, tableToken)).waiterCallEnabled, false); await expect(await save(), 200);
      }
      await expect(await save({ ...settings, billRequestEnabled: false }), 200); await expect(await call('BILL_REQUEST'), 404); await expect(await save(), 200);
    });
    await t.test('DB constraints prevent cross-tenant/table links and duplicate open requests', async () => {
      await assert.rejects(db.serviceRequest.create({ data: { organizationId: otherOrg.id, branchId: branch.id, tableId: table.id, type: 'WAITER_CALL' } }));
      await assert.rejects(db.serviceRequest.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table2.id, tabId: tab.id, type: 'BILL_REQUEST' } }));
      await assert.rejects(db.serviceRequest.create({ data: { organizationId: org.id, branchId: branch.id, tableId: table.id, type: 'WAITER_CALL' } }));
    });
    await t.test('origin, JSON/body limits, forged IDs, durable table limits and audit token redaction', async () => {
      await expect(await publicApi.POST(request('POST', '/api/menu/x/requests', { type: 'WAITER_CALL', tableToken }, 'https://evil.test'), context({ token: menuToken })), 403);
      await expect(await publicApi.POST(request('POST', '/api/menu/x/requests', { type: 'WAITER_CALL', tableToken, organizationId: org.id }), context({ token: menuToken })), 400);
      await expect(await publicApi.POST(request('POST', '/api/menu/x/requests', { type: 'WAITER_CALL', tableToken, data: 'a'.repeat(3000) }), context({ token: menuToken })), 413);
      const waiterRow = await find('WAITER_CALL'); await expect(await action(waiterRow.id, 'CANCEL'), 200);
      await db.serviceRequest.updateMany({ where: { tableId: table.id }, data: { createdAt: new Date(Date.now() - 60000) } });
      await db.restaurantTable.update({ where: { id: table.id }, data: { requestWindowStartedAt: new Date(), requestWindowCount: 6 } }); await expect(await call(), 429);
      const audits = await db.auditLog.findMany({ where: { organizationId: org.id } }); assert(audits.some(a => a.action === 'SERVICE_REQUEST_COMPLETE')); assert(!JSON.stringify(audits).includes(tableToken));
      for (let i = 0; i < 301; i++) { try { service.publicRequestGuard(request('POST', '/api/menu/x')); } catch (e) { assert.equal(e.status, 429); return; } } assert.fail('rate limit not enforced');
    });
  } finally { Module._load = load; await db.$disconnect(); }
});
