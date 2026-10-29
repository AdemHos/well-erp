/* eslint-disable @typescript-eslint/no-require-imports -- Rollback-only Prisma integration harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const crypto = require('node:crypto');

test('staff profiles: PIN setup/lockout, shared-account permissions, isolation, audit and session revocation', { skip: process.env.WELLPOS_PROFILES_DB_TEST !== '1', timeout: 180000 }, async () => {
  require('dotenv').config({ quiet: true });
  require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  const { PrismaClient } = require('../src/generated/prisma/client.ts');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const bcrypt = require('bcryptjs');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const originalLoad = Module._load, originalError = console.error;
  const slug = 'profile-check-' + crypto.randomUUID(), rollback = new Error('ROLLBACK_PROFILE_FIXTURES');
  try {
    try { await db.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: 'Profiles fixture', slug } });
      const foreign = await tx.organization.create({ data: { name: 'Other', slug: slug + '-other' } });
      const a = await tx.branch.create({ data: { organizationId: org.id, name: 'A' } });
      const b = await tx.branch.create({ data: { organizationId: org.id, name: 'B' } });
      const c = await tx.branch.create({ data: { organizationId: foreign.id, name: 'C' } });
      const owner = await tx.user.create({ data: { email: slug + '@example.test', name: 'Owner', password: await bcrypt.hash('fixture-password', 4) } });
      const member = await tx.membership.create({ data: { userId: owner.id, organizationId: org.id, role: 'OWNER' } });
      const cookieMap = new Map([['wellpos-active-organization', org.id]]);
      let email = owner.email, device = 'fixture-device', failAudit = false;
      let tail = Promise.resolve();
      const transaction = callback => {
        const promise = tail.then(async () => {
          await tx.$executeRawUnsafe('SAVEPOINT profile_case');
          try {
            const scoped = new Proxy(tx, { get(target, key) { if (key === 'auditLog' && failAudit) return { create: async () => { throw new Error('AUDIT_FAILURE'); } }; return Reflect.get(target, key, target); } });
            const value = await callback(scoped); await tx.$executeRawUnsafe('RELEASE SAVEPOINT profile_case'); return value;
          } catch (error) { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT profile_case'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT profile_case'); throw error; }
        }); tail = promise.catch(() => {}); return promise;
      };
      const client = new Proxy(tx, { get(target, key) { return key === '$transaction' ? transaction : Reflect.get(target, key, target); } });
      Module._load = function (request, parent, isMain) {
        if (request === '@/lib/prisma') return { prisma: client };
        if (request === '@/auth') return { auth: async () => email ? { user: { email }, deviceSessionId: device, authenticatedAt: Date.now() } : null };
        if (request === 'next/headers') return { cookies: async () => ({ get: key => cookieMap.has(key) ? { value: cookieMap.get(key) } : undefined, set: (key, value) => cookieMap.set(key, value), delete: key => cookieMap.delete(key) }) };
        if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
        return originalLoad.call(this, request, parent, isMain);
      };
      const current = require('../src/lib/current-membership.ts');
      const profiles = require('../src/lib/staff-profiles.ts');
      const selection = require('../src/app/api/profile-session/route.ts');
      const management = require('../src/app/api/profiles/route.ts');
      const managementItem = require('../src/app/api/profiles/[id]/route.ts');
      const finance = require('../src/app/api/finance/accounts/route.ts');
      const branches = require('../src/app/api/branches/route.ts');
      const orders = require('../src/app/api/orders/route.ts');
      const legacyStaff = require('../src/app/api/staff/[id]/route.ts');
      const organizationSwitch = require('../src/app/api/organizations/active/route.ts');
      Module._load = originalLoad; console.error = () => {};
      const req = (url, body, method = 'POST') => new Request('http://localhost' + url, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const status = async (promise, expected) => { const response = await promise; assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); return response; };
      const choose = (profileId, pin, password) => selection.POST(req('/api/profile-session', { profileId, pin, password }));
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 428);
      const initial = await (await selection.GET()).json();
      assert.equal(initial.profiles[0].id, 'self'); assert.equal(initial.profiles[0].needsSetup, true);
      await status(choose('self', '123456', 'wrong'), 403);
      await status(choose('self', '123456', 'fixture-password'), 200);
      const ownerIdentity = await current.getCurrentMembership();
      assert.equal(ownerIdentity.role, 'OWNER'); assert(ownerIdentity.profileId);
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 200);
      const create = await status(management.POST(req('/api/profiles', { name: 'Cashier fixture', role: 'CASHIER', branchId: a.id })), 201);
      const cashier = await create.json(); assert.match(cashier.pin, /^\d{6}$/);
      const saved = await tx.staffProfile.findUnique({ where: { id: cashier.id } });
      assert.notEqual(saved.pinHash, cashier.pin); assert.equal(await bcrypt.compare(cashier.pin, saved.pinHash), true);
      assert.equal(await tx.user.count({ where: { email: { startsWith: slug } } }), 1, 'No fabricated email/user for local staff');
      const roster = JSON.stringify(await (await management.GET()).json()); assert(!roster.includes(saved.pinHash)); assert(!roster.includes(cashier.pin));
      await status(management.POST(req('/api/profiles', { name: 'Bad', role: 'OWNER', branchId: a.id })), 400);
      await status(management.POST(req('/api/profiles', { name: 'Bad', role: 'CASHIER', branchId: c.id })), 404);
      // Failure to select invalidates the prior OWNER session.
      await status(choose(cashier.id, 'not-a-pin'), 400);
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 428);
      const wrongPin = cashier.pin === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i++) await status(choose(cashier.id, wrongPin), 403);
      await status(choose(cashier.id, cashier.pin), 429);
      assert.equal((await tx.staffProfile.findUnique({ where: { id: cashier.id } })).failedAttempts, 5);
      await tx.staffProfile.update({ where: { id: cashier.id }, data: { lockedUntil: new Date(0), failedAttempts: 0 } });
      await status(choose(cashier.id, cashier.pin), 200);
      const effective = await current.getCurrentMembership();
      assert.equal(effective.role, 'CASHIER'); assert.equal(effective.user.name, 'Cashier fixture'); assert.equal(effective.userId, owner.id);
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 403);
      await status(management.POST(req('/api/profiles', { name: 'Escalate', role: 'ADMIN', branchId: a.id })), 403);
      await status(legacyStaff.PATCH(req('/api/staff/' + member.id, { role: 'ADMIN' }, 'PATCH'), { params: Promise.resolve({ id: member.id }) }), 403);
      const visible = await (await branches.GET()).json(); assert.deepEqual(visible.branches.map(v => v.id), [a.id]);
      const product = await tx.product.create({ data: { name: 'Item', price: 100, organizationId: org.id } });
      await tx.branchStock.create({ data: { organizationId: org.id, branchId: a.id, productId: product.id, quantity: 5 } });
      await tx.financeAccount.create({ data: { organizationId: org.id, branchId: a.id, name: 'Cash', type: 'CASH' } });
      const sold = await (await status(orders.POST(req('/api/orders', { idempotencyKey: crypto.randomUUID(), branchId: a.id, paymentMethod: 'CASH', items: [{ productId: product.id, quantity: 1 }] })), 201)).json();
      const audit = await tx.auditLog.findFirst({ where: { action: 'orders.sale', entityId: sold.order.id } }); assert.equal(audit.actorProfileId, cashier.id); assert.equal(audit.actorUserId, owner.id);
      await status(orders.POST(req('/api/orders', { idempotencyKey: crypto.randomUUID(), branchId: b.id, paymentMethod: 'CASH', items: [{ productId: product.id, quantity: 1 }] })), 404);
      const stolen = cookieMap.get(profiles.PROFILE_COOKIE); device = 'another-login';
      await status(orders.GET(req('/api/orders', null, 'GET')), 428); device = 'fixture-device';
      // Local role changes must invalidate the old session and any stale actor.
      await tx.staffProfile.update({ where: { id: cashier.id }, data: { credentialVersion: { increment: 1 } } });
      await status(orders.GET(req('/api/orders', null, 'GET')), 428);
      await assert.rejects(profiles.saveLocalProfile(effective, null, { name: 'Escalate', role: 'ADMIN', branchId: a.id }), e => e.status === 403);
      await status(choose(ownerIdentity.profileId, '123456'), 200);
      failAudit = true;
      await status(management.POST(req('/api/profiles', { name: 'Should rollback', role: 'WAITER', branchId: a.id })), 500);
      assert.equal(await tx.staffProfile.count({ where: { organizationId: org.id, name: 'Should rollback' } }), 0); failAudit = false;
      const reset = await (await status(managementItem.PATCH(req('/api/profiles/' + cashier.id, { resetPin: true }, 'PATCH'), { params: Promise.resolve({ id: cashier.id }) }), 200)).json();
      assert.match(reset.pin, /^\d{6}$/);
      await status(choose(cashier.id, cashier.pin), 403);
      await status(choose(cashier.id, reset.pin), 200);
      await tx.staffProfile.update({ where: { id: cashier.id }, data: { isActive: false } });
      await status(orders.GET(req('/api/orders', null, 'GET')), 428);
      await status(choose(ownerIdentity.profileId, '123456'), 200);
      const otherMember = await tx.membership.create({ data: { organizationId: foreign.id, userId: owner.id, role: 'OWNER' } });
      const otherProfile = await tx.staffProfile.create({ data: { organizationId: foreign.id, membershipId: otherMember.id, name: 'Foreign', role: 'OWNER', pinHash: await bcrypt.hash('123456', 4) } });
      await status(choose(otherProfile.id, '123456'), 403);
      await status(choose(ownerIdentity.profileId, '123456'), 200);
      await status(organizationSwitch.POST(req('/api/organizations/active', { organizationId: foreign.id })), 200);
      assert.equal(cookieMap.has(profiles.PROFILE_COOKIE), false);
      cookieMap.set(profiles.PROFILE_COOKIE, stolen);
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 428);
      cookieMap.set('wellpos-active-organization', org.id);
      await status(choose(ownerIdentity.profileId, '123456'), 200);
      await status(selection.DELETE(req('/api/profile-session', null, 'DELETE')), 200);
      await status(finance.GET(req('/api/finance/accounts', null, 'GET')), 428);
      email = null; await status(selection.GET(), 401);
      throw rollback;
    }, { timeout: 170000 }); assert.fail('Fixtures must roll back'); }
    catch (error) { if (error !== rollback) throw error; }
    assert.equal(await db.organization.count({ where: { slug: { startsWith: slug } } }), 0);
  } finally { Module._load = originalLoad; console.error = originalError; await db.$disconnect(); }
});
