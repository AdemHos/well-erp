/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TypeScript authorization tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module'), path = require('node:path'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const load = Module._load;
let profileAccess, canSetupWithGoogle;
try {
  Module._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: {} };
    if (request === '@/auth') return { auth: async () => null };
    if (request === 'next/headers') return { cookies: async () => ({}) };
    if (request.startsWith('@/')) request = path.resolve(__dirname, '../src', request.slice(2));
    return load.call(this, request, parent, isMain);
  };
  ({ profileAccess, canSetupWithGoogle } = require('../src/lib/staff-profiles.ts'));
} finally { Module._load = load; }
const base = { id: 'member', userId: 'owner', organizationId: 'org', role: 'OWNER', isActive: true, allBranches: true, branchAccess: [], user: { id: 'owner', name: 'Owner', email: 'fixture@example.test', image: null }, organization: { id: 'org', name: 'Org' } };
const profile = { id: 'cashier', organizationId: 'org', membershipId: null, membership: null, role: 'CASHIER', name: 'Cashier', isActive: true, allBranches: false, branchAccess: [{ branchId: 'A' }] };
test('local profile replaces OWNER privileges while preserving the actual authenticated actor', () => {
  const effective = profileAccess(base, profile);
  assert.equal(effective.role, 'CASHIER'); assert.equal(effective.userId, 'owner'); assert.equal(effective.user.name, 'Cashier'); assert.equal(effective.profileId, 'cashier'); assert.equal(effective.allBranches, false);
});
test('inactive and cross-organization profiles fail closed', () => {
  assert.equal(profileAccess(base, { ...profile, isActive: false }), null);
  assert.equal(profileAccess(base, { ...profile, organizationId: 'foreign' }), null);
  assert.equal(profileAccess(base, { ...profile, role: '__proto__' }), null);
});
test('a profile cannot extend the principal role or branch scope', () => {
  const cashier = { ...base, role: 'CASHIER', allBranches: false, branchAccess: [{ branchId: 'A' }] };
  assert(profileAccess(cashier, profile));
  assert.equal(profileAccess(cashier, { ...profile, role: 'ADMIN' }), null);
  assert.equal(profileAccess(cashier, { ...profile, allBranches: true }), null);
  assert.equal(profileAccess(cashier, { ...profile, branchAccess: [{ branchId: 'B' }] }), null);
});
test('real-account profiles use fresh membership permissions and cannot impersonate another member', () => {
  const linked = { ...profile, membershipId: 'member', membership: { ...base, role: 'KITCHEN', allBranches: false, branchAccess: [{ branchId: 'A' }] } };
  assert.equal(profileAccess(base, linked).role, 'KITCHEN');
  assert.equal(profileAccess(base, { ...linked, membership: { ...linked.membership, isActive: false } }), null);
  assert.equal(profileAccess(base, { ...linked, membership: { ...linked.membership, userId: 'other-user' } }), null);
});

test('Google PIN setup requires a recent login; reset requires login newer than the last profile use', () => {
  const now = 1000000, updated = new Date(now - 10000);
  assert.equal(canSetupWithGoogle(now - 20000, updated, false, now), true);
  assert.equal(canSetupWithGoogle(now - 20000, updated, true, now), false);
  assert.equal(canSetupWithGoogle(now - 5000, updated, true, now), true);
  assert.equal(canSetupWithGoogle(now - 300001, updated, false, now), false);
  assert.equal(canSetupWithGoogle(now + 1000, updated, false, now), false);
});
