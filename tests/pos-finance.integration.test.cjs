/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in integration harness for actual server handlers and generated Prisma client. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

test("POS finance/refund integration: history, accounts, net amounts, balances, uniqueness and rollback", {
  skip: process.env.WELLPOS_FINANCE_DB_TEST !== "1",
  timeout: 120000,
}, async () => {
  require("dotenv").config({ quiet: true });
  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.url", JSON.stringify(require("node:url").pathToFileURL(filename).href));
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, filename);
  };
  const { PrismaClient, Prisma } = require("../src/generated/prisma/client.ts");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { NextRequest } = require("next/server");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const rollback = new Error("ROLL_BACK_ALL_TEST_FIXTURES");
  const slug = `finance-check-${crypto.randomUUID()}`;
  const load = Module._load;
  const logError = console.error;
  try {
    try {
      await db.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: "Finance integration fixture", slug } });
        const actor = await tx.user.create({ data: { email: `${slug}@example.test`, name: "Integration Owner" } });
        await tx.membership.create({ data: { userId: actor.id, organizationId: org.id, role: "OWNER" } });
        const otherOrg = await tx.organization.create({ data: { name: "Foreign fixture", slug: `${slug}-other` } });
        const branches = [];
        for (const name of ["A", "B", "No accounts", "Multiple accounts"]) {
          branches.push(await tx.branch.create({ data: { name, organizationId: org.id } }));
        }
        const foreignBranch = await tx.branch.create({ data: { name: "Foreign", organizationId: otherOrg.id } });
        const account = (branch, type, name, isActive = true) => tx.financeAccount.create({ data: {
          organizationId: branch.organizationId, branchId: branch.id, name, type, isActive, openingBalance: 100,
        } });
        const cash = await account(branches[0], "CASH", "Cash A");
        const card = await account(branches[0], "CARD", "Card A");
        const cashB = await account(branches[1], "CASH", "Cash B");
        const inactive = await account(branches[0], "CASH", "Inactive", false);
        const foreign = await account(foreignBranch, "CASH", "Foreign");
        const multi = await account(branches[3], "CASH", "First");
        await account(branches[3], "CASH", "Second");
        const product = await tx.product.create({ data: { name: "Finance test item", organizationId: org.id, price: 100, isSellable: true } });
        await tx.branchStock.createMany({ data: branches.map((branch) => ({ organizationId: org.id, branchId: branch.id, productId: product.id, quantity: 100 })) });

        let activeBranch = branches[0].id;
        let failFinance = false;
        let membershipRole = "OWNER";
        // Each handler call receives a real savepoint inside the outer fixture
        // transaction, so failed calls actually roll back their database writes.
        const transaction = async (callback) => {
          await tx.$executeRawUnsafe("SAVEPOINT pos_finance_test");
          try {
            const guarded = new Proxy(tx, { get(target, key) {
              if (key === "financeTransaction" && failFinance) return { create: async () => { throw new Error("Injected finance failure"); } };
              return Reflect.get(target, key, target);
            } });
            const value = await callback(guarded);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT pos_finance_test");
            return value;
          } catch (error) {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT pos_finance_test");
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT pos_finance_test");
            throw error;
          }
        };
        const client = new Proxy(tx, { get(target, key) { return key === "$transaction" ? transaction : Reflect.get(target, key, target); } });
        Module._load = function (request, parent, isMain) {
          if (request === "@/lib/prisma") return { prisma: client };
          if (request === "@/lib/current-membership") return { getCurrentMembership: async () => ({ organizationId: org.id, role: membershipRole, userId: actor.id, allBranches: true, branchAccess: [] }) };
          if (request === "next/headers") return { cookies: async () => ({ get: () => ({ value: activeBranch }) }) };
          if (request.startsWith("@/")) request = path.resolve(__dirname, "../src", request.slice(2));
          return load.call(this, request, parent, isMain);
        };
        const { POST, GET: history } = require("../src/app/api/orders/route.ts");
        const { POST: refund } = require("../src/app/api/orders/[id]/refund/route.ts");
        const { GET: detail, PATCH: cancel } = require("../src/app/api/orders/[id]/route.ts");
        const financeAPI = require("../src/app/api/finance/transactions/route.ts");
        const accountsAPI = require("../src/app/api/finance/accounts/route.ts");
        Module._load = load;
        console.error = () => {}; // Expected failure cases must not dump query data.
        const sell = async (changes = {}) => {
          const response = await POST(new Request("http://localhost/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(), branchId: activeBranch, paymentMethod: "CASH", items: [{ productId: product.id, quantity: 1 }], ...changes,
          }) }));
          return { status: response.status, body: await response.json() };
        };
        const snapshot = async () => ({
          orders: await tx.order.count({ where: { organizationId: org.id } }),
          movements: await tx.stockMovement.count({ where: { organizationId: org.id } }),
          finance: await tx.financeTransaction.count({ where: { organizationId: org.id } }),
          statuses: await tx.order.findMany({ where: { organizationId: org.id }, select: { id: true, status: true }, orderBy: { id: "asc" } }),
          stocks: (await tx.branchStock.findMany({ where: { organizationId: org.id }, orderBy: { branchId: "asc" } })).map((row) => [row.branchId, row.quantity.toString()]),
        });
        const rejectWithoutWrites = async (input, status) => {
          const before = await snapshot();
          assert.equal((await sell(input)).status, status);
          assert.deepEqual(await snapshot(), before);
        };

        const first = await sell();
        assert.equal(first.status, 201);
        let entry = await tx.financeTransaction.findUnique({ where: { orderId_source: { orderId: first.body.order.id, source: "POS_SALE" } } });
        assert.equal(entry.accountId, cash.id);
        assert.equal(entry.direction, "IN");
        assert.equal(entry.organizationId, org.id);
        assert.equal(entry.branchId, branches[0].id);
        assert(entry.amount.eq(100));
        assert(entry.description.includes(first.body.order.orderNumber));
        assert.equal(entry.occurredAt.toISOString(), first.body.order.createdAt);

        const discounted = await sell({ paymentMethod: "CARD", discount: { type: "PERCENT", value: 10 } });
        assert.equal(discounted.status, 201);
        entry = await tx.financeTransaction.findUnique({ where: { orderId_source: { orderId: discounted.body.order.id, source: "POS_SALE" } } });
        assert.equal(entry.accountId, card.id);
        assert(entry.amount.eq(90));
        const fixed = await sell({ discount: { type: "FIXED", value: 25 } });
        assert.equal(fixed.status, 201);
        assert((await tx.financeTransaction.findUnique({ where: { orderId_source: { orderId: fixed.body.order.id, source: "POS_SALE" } } })).amount.eq(75));

        await rejectWithoutWrites({ items: [{ productId: product.id, quantity: 1000 }] }, 409);
        for (const id of [cashB.id, card.id, inactive.id, foreign.id]) await rejectWithoutWrites({ financeAccountId: id }, 409);
        activeBranch = branches[2].id;
        await rejectWithoutWrites({}, 409);
        const zero = await sell({ discount: { type: "PERCENT", value: 100 } });
        assert.equal(zero.status, 201);
        assert.equal(await tx.financeTransaction.count({ where: { orderId: zero.body.order.id } }), 0);
        activeBranch = branches[1].id;
        const secondBranch = await sell();
        assert.equal(secondBranch.status, 201);
        assert.equal((await tx.financeTransaction.findUnique({ where: { orderId_source: { orderId: secondBranch.body.order.id, source: "POS_SALE" } } })).accountId, cashB.id);

        activeBranch = branches[3].id;
        await rejectWithoutWrites({}, 409);
        assert.equal((await sell({ financeAccountId: multi.id })).status, 201);
        activeBranch = branches[0].id;
        failFinance = true;
        await rejectWithoutWrites({}, 500);
        failFinance = false;

        // Exercise the real PostgreSQL unique constraint and roll back the failed statement.
        await tx.$executeRawUnsafe("SAVEPOINT duplicate_entry");
        await assert.rejects(tx.financeTransaction.create({ data: {
          organizationId: org.id, branchId: activeBranch, accountId: cash.id,
          orderId: first.body.order.id, direction: "IN", source: "POS_SALE", amount: 100,
        } }), (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT duplicate_entry");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT duplicate_entry");

        const balances = await (await accountsAPI.GET()).json();
        assert.equal(balances.accounts.find((row) => row.id === cash.id).balance, "275");
        assert.equal(balances.accounts.find((row) => row.id === card.id).balance, "190");
        const listed = await (await financeAPI.GET(new NextRequest(`http://localhost/api/finance/transactions?branchId=${activeBranch}`))).json();
        assert(listed.transactions.some((row) => row.source === "POS_SALE" && row.order.orderNumber === first.body.order.orderNumber));
        assert.equal(financeAPI.PATCH, undefined);
        assert.equal(financeAPI.DELETE, undefined);

        // A forged source/orderId in a manual request must not impersonate POS bookkeeping.
        const manual = await financeAPI.POST(new NextRequest("http://localhost/api/finance/transactions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(), accountId: cash.id, amount: 5, direction: "IN", source: "POS_SALE", orderId: first.body.order.id,
          }),
        }));
        assert.equal(manual.status, 201);
        const manualEntry = await tx.financeTransaction.findFirst({ where: { organizationId: org.id, source: "MANUAL" } });
        assert(manualEntry.amount.eq(5));
        assert.equal(manualEntry.orderId, null);

        // History is filtered and paginated in the database, scoped to active branch.
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.body.order.createdAt));
        const historyURL = new URL("http://localhost/api/orders");
        historyURL.searchParams.set("search", first.body.order.orderNumber);
        historyURL.searchParams.set("paymentMethod", "CASH");
        historyURL.searchParams.set("startDate", day);
        historyURL.searchParams.set("endDate", day);
        const historyData = await (await history(new Request(historyURL))).json();
        assert.equal(historyData.total, 1);
        assert.equal(historyData.orders[0].id, first.body.order.id);
        assert.equal(historyData.orders[0].organization.name, org.name);
        const paged = await (await history(new Request("http://localhost/api/orders?limit=1&page=2"))).json();
        assert.equal(paged.orders.length, 1);
        assert(paged.totalPages >= 3);
        assert.notEqual(paged.orders[0].branch.id, branches[1].id);
        for (const query of ["page=0", "limit=101", "paymentMethod=BANK", "startDate=2026-02-30", "startDate=2026-12-02&endDate=2026-12-01"]) {
          assert.equal((await history(new Request("http://localhost/api/orders?" + query))).status, 400);
        }

        const ctx = (id) => ({ params: Promise.resolve({ id }) });
        const refundRequest = () => new Request("http://localhost/api/orders/refund", { method: "POST", body: JSON.stringify({ amount: 99999, quantity: 99999 }) });
        const refundOrder = (id) => refund(refundRequest(), ctx(id));
        const assertRejected = async (id, status) => {
          const before = await snapshot();
          assert.equal((await refundOrder(id)).status, status);
          assert.deepEqual(await snapshot(), before);
        };
        assert.equal((await cancel(refundRequest(), ctx(first.body.order.id))).status, 409);
        membershipRole = "CASHIER";
        await assertRejected(first.body.order.id, 403);
        membershipRole = "OWNER";
        activeBranch = branches[1].id;
        assert.equal((await detail(refundRequest(), ctx(first.body.order.id))).status, 404);
        await assertRejected(first.body.order.id, 404);
        activeBranch = branches[0].id;
        const foreignOrder = await tx.order.create({ omit: { customerId: true, customerSnapshot: true }, data: { organizationId: otherOrg.id, branchId: foreignBranch.id, orderNumber: "FOREIGN", paymentMethod: "CASH", subtotal: 10, total: 10 } });
        assert.equal((await detail(refundRequest(), ctx(foreignOrder.id))).status, 404);
        await assertRejected(foreignOrder.id, 404);

        // Fail after stock restoration to prove real savepoint rollback of every effect.
        failFinance = true;
        await assertRejected(first.body.order.id, 500);
        failFinance = false;
        // Returning to an inactive original account is allowed; another active
        // account must never silently replace the account used for the sale.
        await tx.financeAccount.update({ where: { id: cash.id }, data: { isActive: false } });
        await tx.product.update({ where: { id: product.id }, data: { isActive: false, isSellable: false } });
        for (const [saleResult, accountId, amount] of [[first, cash.id, 100], [discounted, card.id, 90], [fixed, cash.id, 75]]) {
          const beforeStock = await tx.branchStock.findUnique({ where: { branchId_productId: { branchId: activeBranch, productId: product.id } } });
          const result = await refundOrder(saleResult.body.order.id);
          assert.equal(result.status, 200);
          const refunded = await result.json();
          assert.equal(refunded.order.status, "REFUNDED");
          const pair = await tx.financeTransaction.findMany({ where: { orderId: saleResult.body.order.id } });
          assert.equal(pair.length, 2);
          const returned = pair.find((row) => row.source === "POS_REFUND");
          assert.equal(returned.direction, "OUT");
          assert.equal(returned.accountId, accountId);
          assert(returned.amount.eq(amount));
          assert(pair.some((row) => row.source === "POS_SALE" && row.direction === "IN"));
          const afterStock = await tx.branchStock.findUnique({ where: { branchId_productId: { branchId: activeBranch, productId: product.id } } });
          assert(afterStock.quantity.eq(beforeStock.quantity.plus(1)));
          assert.equal(await tx.stockMovement.count({ where: { organizationId: org.id, reference: refunded.order.orderNumber, type: "RETURN" } }), 1);
          await assertRejected(saleResult.body.order.id, 409);
        }
        activeBranch = branches[2].id;
        assert.equal((await refundOrder(zero.body.order.id)).status, 200);
        assert.equal(await tx.financeTransaction.count({ where: { orderId: zero.body.order.id } }), 0);
        activeBranch = branches[0].id;
        const afterRefundBalances = await (await accountsAPI.GET()).json();
        assert.equal(afterRefundBalances.accounts.find((row) => row.id === cash.id).balance, "105");
        assert.equal(afterRefundBalances.accounts.find((row) => row.id === card.id).balance, "100");
        throw rollback;
      }, { timeout: 90000 });
      assert.fail("Fixture transaction must never commit");
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal(await db.organization.count({ where: { slug: { startsWith: slug } } }), 0, "No test data may persist");
  } finally {
    Module._load = load;
    console.error = logError;
    await db.$disconnect();
  }
});
