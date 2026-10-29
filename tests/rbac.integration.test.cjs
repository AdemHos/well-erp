/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in transaction-scoped integration harness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

test("RBAC integration: fresh memberships, scoped APIs, invitations, audit and last OWNER", { skip: process.env.WELLPOS_RBAC_DB_TEST !== "1", timeout: 180000 }, async () => {
  require("dotenv").config({ quiet: true });
  require.extensions[".ts"] = (module, file) => {
    const source = fs.readFileSync(file, "utf8").replaceAll("import.meta.url", JSON.stringify(require("node:url").pathToFileURL(file).href));
    module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  };
  const { PrismaClient } = require("../src/generated/prisma/client.ts");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { NextRequest } = require("next/server");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const slug = "rbac-check-" + crypto.randomUUID();
  const rollback = new Error("ROLLBACK_FIXTURES");
  const load = Module._load;
  const log = console.error;
  try {
    try { await db.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: "RBAC fixture", slug } });
      const foreign = await tx.organization.create({ data: { name: "Foreign fixture", slug: slug + "-other" } });
      const a = await tx.branch.create({ data: { name: "A", organizationId: org.id } });
      const b = await tx.branch.create({ data: { name: "B", organizationId: org.id } });
      const c = await tx.branch.create({ data: { name: "C", organizationId: foreign.id } });
      const users = {}, members = {};
      for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN", "STAFF"]) {
        users[role] = await tx.user.create({ data: { email: `${slug}-${role.toLowerCase()}@example.test`, name: role } });
        members[role] = await tx.membership.create({ data: { userId: users[role].id, organizationId: org.id, role,
          allBranches: role === "OWNER", branchAccess: role === "OWNER" ? undefined : { create: { branchId: a.id } },
        } });
      }
      await tx.membership.create({ data: { userId: users.CASHIER.id, organizationId: foreign.id, role: "KITCHEN", allBranches: true } });
      const tokens = new Map();
      for (const member of await tx.membership.findMany({ where: { organizationId: { in: [org.id, foreign.id] } } })) {
        const profile = await tx.staffProfile.create({ data: { organizationId: member.organizationId, membershipId: member.id, name: 'Fixture', role: member.role } });
        const token = require('node:crypto').randomBytes(32).toString('base64url');
        tokens.set(member.userId + ':' + member.organizationId, token);
        const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
        await tx.staffProfileSession.create({ data: { profileId: profile.id, organizationId: member.organizationId, userId: member.userId, tokenHash: sha(token), deviceSessionHash: sha('rbac-device'), credentialVersion: 1, expiresAt: new Date(Date.now()+3600000) } });
      }
      const cashA = await tx.financeAccount.create({ data: { organizationId: org.id, branchId: a.id, name: "Cash A", type: "CASH" } });
      const cashB = await tx.financeAccount.create({ data: { organizationId: org.id, branchId: b.id, name: "Cash B", type: "CASH" } });
      const product = await tx.product.create({ data: { organizationId: org.id, name: "Item", price: 100, costPrice: 20 } });
      await tx.branchStock.createMany({ data: [a, b].map((branch) => ({ organizationId: org.id, branchId: branch.id, productId: product.id, quantity: 100 })) });
      const tableA = await tx.restaurantTable.create({ data: { organizationId: org.id, branchId: a.id, name: "A1" } });
      const tableB = await tx.restaurantTable.create({ data: { organizationId: org.id, branchId: b.id, name: "B1" } });
      let email = users.OWNER.email, selectedOrg = org.id, selectedBranch = a.id, failAudit = false;
      let tail = Promise.resolve();
      const transaction = (callback) => {
        const pending = tail.then(async () => {
          await tx.$executeRawUnsafe("SAVEPOINT rbac_case");
          try {
            const scoped = new Proxy(tx, { get(target, key) { if (key === "auditLog" && failAudit) return { create: async () => { throw new Error("Audit write failure"); } }; return Reflect.get(target, key, target); } });
            const result = await callback(scoped);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT rbac_case"); return result;
          } catch (error) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rbac_case"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT rbac_case"); throw error; }
        });
        tail = pending.catch(() => {}); return pending;
      };
      const client = new Proxy(tx, { get(target, key) { return key === "$transaction" ? transaction : Reflect.get(target, key, target); } });
      Module._load = function (request, parent, isMain) {
        if (request === "@/lib/prisma") return { prisma: client };
        if (request === "@/auth") return { auth: async () => email ? { user: { email }, deviceSessionId: "rbac-device", authenticatedAt: Date.now() } : null };
        if (request === "next/headers") return { cookies: async () => ({ get: (name) => ({ value: name === "wellpos-active-organization" ? selectedOrg : name === "wellpos-active-branch" ? selectedBranch : name === "wellpos-staff-session" ? tokens.get(Object.values(users).find(u => u.email === email)?.id + ":" + selectedOrg) : undefined }), set: () => {}, delete: () => {} }) };
        if (request === "next/navigation") return { redirect: (url) => { throw new Error("Unexpected redirect " + url); } };
        if (request.startsWith("@/")) request = path.resolve(__dirname, "../src", request.slice(2));
        return load.call(this, request, parent, isMain);
      };
      const { getCurrentMembership } = require("../src/lib/current-membership.ts");
      const staff = require("../src/lib/staff-service.ts");
      const orders = require("../src/app/api/orders/route.ts");
      const refunds = require("../src/app/api/orders/[id]/refund/route.ts");
      const finance = require("../src/app/api/finance/accounts/route.ts");
      const manualFinance = require("../src/app/api/finance/transactions/route.ts");
      const products = require("../src/app/api/products/route.ts");
      const branches = require("../src/app/api/branches/route.ts");
      const active = require("../src/app/api/branches/active/route.ts");
      const tabs = require("../src/app/api/restaurant/tabs/route.ts");
      const tabItems = require("../src/app/api/restaurant/tabs/[id]/items/route.ts");
      const kitchen = require("../src/app/api/restaurant/kitchen/route.ts");
      const kitchenItem = require("../src/app/api/restaurant/kitchen/items/[itemId]/route.ts");
      const staffAPI = require("../src/app/api/staff/route.ts");
      Module._load = load; console.error = () => {};
      const request = (url, body, contentType = "application/json") => new NextRequest("http://localhost" + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body) });
      const context = (id) => ({ params: Promise.resolve({ id }) });
      const as = (role) => { email = users[role].email; selectedOrg = org.id; selectedBranch = a.id; };
      const saleBody = { idempotencyKey: crypto.randomUUID(), branchId: a.id, paymentMethod: "CASH", items: [{ productId: product.id, quantity: 1 }] };
      const expectStatus = async (result, status) => { const response = await result; assert.equal(response.status, status, (await response.clone().text()).slice(0, 300)); return response; };

      // A cashier can sell without receiving finance-management privileges or costs.
      as("CASHIER");
      const sold = await (await expectStatus(orders.POST(request("/api/orders", saleBody)), 201)).json();
      assert.equal((await tx.financeTransaction.findUnique({ where: { orderId_source: { orderId: sold.order.id, source: "POS_SALE" } } })).accountId, cashA.id);
      await expectStatus(finance.GET(request("/api/finance/accounts")), 403);
      await expectStatus(refunds.POST(request("/api/orders/refund", {}), context(sold.order.id)), 403);
      const catalog = await (await expectStatus(products.GET(request("/api/products")), 200)).json();
      assert.equal(catalog.products[0].costPrice, undefined);
      assert.equal((await (await branches.GET(request("/api/branches"))).json()).branches.length, 1);
      await expectStatus(active.POST(request("/api/branches/active", { branchId: b.id })), 404);
      await expectStatus(active.POST(request("/api/branches/active", { branchId: c.id })), 404);
      await expectStatus(orders.POST(request("/api/orders", { ...saleBody, branchId: b.id }, "text/plain")), 404);
      selectedBranch = b.id;
      const visibleSales = await (await orders.GET(request("/api/orders"))).json();
      assert(visibleSales.orders.every((order) => order.branch.id === a.id));
      selectedBranch = a.id;

      as("WAITER");
      await expectStatus(orders.POST(request("/api/orders", saleBody)), 403);
      await expectStatus(manualFinance.POST(request("/api/finance/transactions", {})), 403);
      await expectStatus(tabs.POST(request("/api/restaurant/tabs", { tableId: tableB.id })), 404);
      const opened = await (await expectStatus(tabs.POST(request("/api/restaurant/tabs", { tableId: tableA.id })), 201)).json();
      const added = await (await expectStatus(tabItems.POST(request("/api/restaurant/tabs/items", { productId: product.id, quantity: 1 }), context(opened.tab.id)), 201)).json();
      as("KITCHEN");
      await expectStatus(kitchen.GET(request(`/api/restaurant/kitchen?branchId=${a.id}`)), 200);
      await expectStatus(kitchen.GET(request(`/api/restaurant/kitchen?branchId=${b.id}`)), 404);
      await expectStatus(kitchenItem.PATCH(request("/api/restaurant/kitchen/items", { status: "PREPARING" }), { params: Promise.resolve({ itemId: added.item.id }) }), 200);
      await expectStatus(orders.POST(request("/api/orders", saleBody)), 403);
      await expectStatus(finance.GET(request("/api/finance/accounts")), 403);
      as("STAFF"); await expectStatus(orders.GET(request("/api/orders")), 403);

      as("MANAGER");
      const accounts = await (await expectStatus(finance.GET(request("/api/finance/accounts")), 200)).json();
      assert.deepEqual(accounts.accounts.map((account) => account.id), [cashA.id]);
      await expectStatus(finance.POST(request("/api/finance/accounts", { branchId: b.id, type: "CASH", name: "Forbidden", openingBalance: 0 })), 404);
      const managerIdentity = await getCurrentMembership();
      await assert.rejects(staff.inviteStaff(managerIdentity, { email: "no@example.test", role: "CASHIER", allBranches: false, branchIds: [a.id] }), (error) => error.status === 403);

      as("ADMIN"); const adminIdentity = await getCurrentMembership();
      for (const role of ["OWNER", "ADMIN"]) await assert.rejects(staff.inviteStaff(adminIdentity, { email: "no@example.test", role, allBranches: false, branchIds: [a.id] }), (error) => error.status === 403);
      await assert.rejects(staff.changeStaff(adminIdentity, members.OWNER.id, { role: "STAFF" }), (error) => error.status === 403);
      await assert.rejects(staff.inviteStaff(adminIdentity, { email: "no@example.test", role: "CASHIER", allBranches: false, branchIds: [b.id] }), (error) => error.status === 403);
      await assert.rejects(staff.inviteStaff(adminIdentity, { email: "no@example.test", role: "CASHIER", allBranches: true }), (error) => error.status === 403);

      as("OWNER"); const ownerIdentity = await getCurrentMembership();
      for (const body of [{ isActive: false }, { role: "MANAGER" }]) await assert.rejects(staff.changeStaff(ownerIdentity, members.OWNER.id, body), (error) => error.status === 409);
      // A failed audit must roll back the membership change, not merely the log.
      failAudit = true;
      await assert.rejects(staff.changeStaff(ownerIdentity, members.CASHIER.id, { role: "STAFF", allBranches: false, branchIds: [a.id] }));
      assert.equal((await tx.membership.findUnique({ where: { id: members.CASHIER.id } })).role, "CASHIER");
      failAudit = false;
      await staff.changeStaff(ownerIdentity, members.CASHIER.id, { role: "STAFF", allBranches: false, branchIds: [a.id] });
      as("CASHIER"); await expectStatus(orders.POST(request("/api/orders", saleBody)), 403);
      // Same user, different organization, different role from current DB rows.
      selectedOrg = foreign.id; selectedBranch = c.id;
      assert.equal((await getCurrentMembership()).role, "KITCHEN");
      await expectStatus(orders.GET(request("/api/orders")), 403);
      as("OWNER");
      await staff.changeStaff(ownerIdentity, members.CASHIER.id, { role: "CASHIER", allBranches: false, branchIds: [a.id] });
      await staff.changeStaff(ownerIdentity, members.CASHIER.id, { isActive: false });
      as("CASHIER"); await expectStatus(orders.GET(request("/api/orders")), 403);
      as("OWNER");

      const invitee = await tx.user.create({ data: { email: `${slug}-invitee@example.test` } });
      const invitation = await staff.inviteStaff(ownerIdentity, { email: invitee.email, role: "CASHIER", allBranches: false, branchIds: [a.id] });
      const token = new URLSearchParams(invitation.path.split("#")[1]).get("token");
      const saved = await tx.staffInvitation.findUnique({ where: { id: invitation.id } });
      assert.notEqual(saved.tokenHash, token); assert.equal(saved.tokenHash.length, 64);
      const roster = JSON.stringify(await (await staffAPI.GET(request("/api/staff"))).json());
      assert(!roster.includes(saved.tokenHash)); assert(!roster.includes(token));
      await assert.rejects(staff.acceptStaffInvitation(token, users.MANAGER), (error) => error.status === 403);
      const accepts = await Promise.allSettled([staff.acceptStaffInvitation(token, invitee), staff.acceptStaffInvitation(token, invitee)]);
      assert.equal(accepts.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(await tx.membership.count({ where: { userId: invitee.id, organizationId: org.id, isActive: true } }), 1);
      const assigned = await tx.membershipBranch.findMany({ where: { membership: { userId: invitee.id }, isActive: true } });
      assert.equal(assigned.length, 1); assert.equal(assigned[0].branchId, a.id);
      for (const mode of ["expired", "revoked"]) {
        const user = await tx.user.create({ data: { email: `${slug}-${mode}@example.test` } });
        const created = await staff.inviteStaff(ownerIdentity, { email: user.email, role: "STAFF", allBranches: false, branchIds: [] });
        if (mode === "expired") await tx.staffInvitation.update({ where: { id: created.id }, data: { expiresAt: new Date(0) } });
        else await staff.revokeStaffInvitation(ownerIdentity, created.id);
        await assert.rejects(staff.acceptStaffInvitation(new URLSearchParams(created.path.split("#")[1]).get("token"), user), (error) => error.status === 409);
        assert.equal(await tx.membership.count({ where: { userId: user.id, organizationId: org.id } }), 0);
      }
      // Composite FKs enforce tenant boundaries independently of API guards.
      await tx.$executeRawUnsafe("SAVEPOINT invalid_scope");
      await assert.rejects(tx.membershipBranch.create({ data: { membershipId: members.CASHIER.id, branchId: c.id, organizationId: org.id } }), (error) => error.code === "P2003");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_scope"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT invalid_scope");
      const secondOwner = await tx.user.create({ data: { email: `${slug}-second-owner@example.test` } });
      const secondMembership = await tx.membership.create({ data: { userId: secondOwner.id, organizationId: org.id, role: "OWNER" } });
      const changes = await Promise.allSettled([
        staff.changeStaff(ownerIdentity, members.OWNER.id, { role: "MANAGER", allBranches: true, branchIds: [] }),
        staff.changeStaff({ ...ownerIdentity, userId: secondOwner.id, profileId: undefined, profileSessionId: undefined }, secondMembership.id, { role: "MANAGER", allBranches: true, branchIds: [] }),
      ]);
      assert.equal(changes.filter((entry) => entry.status === "fulfilled").length, 1);
      assert.equal(await tx.membership.count({ where: { organizationId: org.id, role: "OWNER", isActive: true } }), 1);
      await assert.rejects(staff.changeStaff(ownerIdentity, members.WAITER.id, { role: "STAFF" }), (error) => error.status === 403);
      assert(await tx.auditLog.count({ where: { organizationId: org.id } }) >= 8);
      assert.equal(await tx.financeTransaction.count({ where: { accountId: cashB.id } }), 0);
      throw rollback;
    }, { timeout: 150000 }); assert.fail("Fixtures must not commit"); }
    catch (error) { if (error !== rollback) throw error; }
    assert.equal(await db.organization.count({ where: { slug: { startsWith: slug } } }), 0);
    assert.equal(await db.user.count({ where: { email: { startsWith: slug } } }), 0);
  } finally { Module._load = load; console.error = log; await db.$disconnect(); }
});
