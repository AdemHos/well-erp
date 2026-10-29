/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness intercepts server-only dependencies without a database. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Module = require("node:module");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { Prisma } = require("../src/generated/prisma/client.ts");
let stockAvailable = true;
let createdOrder;
let stockUpdate;
let movement;
let productSellable = true;
let productActive = true;
let productOrganization = "org-1";
let accounts = [{ id: "finance-1" }];
let financeEntry;
let financeQuery;
const auditRecords = new Map();
let storedOrder;
const prisma = {
  branch: { findFirst: async () => ({ id: "branch-1", name: "Şube" }) },
  product: { findMany: async ({ where }) => {
    if (where.organizationId !== productOrganization ||
      (where.isActive === true && !productActive) ||
      (where.isSellable === true && !productSellable)) return [];
    return [{ id: "product-1", name: "Kayıtlı ürün", price: new Prisma.Decimal(24) }];
  } },
  $transaction: async (callback) => callback({
    $queryRaw: async () => [],
    product: prisma.product,
    auditLog: { findUnique: async ({where}) => auditRecords.get(where.id) ?? null, create: async ({ data }) => { if(data.id) auditRecords.set(data.id, data); return data; } },
    financeAccount: { findMany: async (args) => {
      args = { ...args, where: args.where.AND?.[0] ?? args.where };
      financeQuery = args;
      assert.equal(args.where.organizationId, "org-1");
      assert.equal(args.where.branchId, "branch-1");
      assert.equal(args.where.isActive, true);
      return accounts.filter((account) => !args.where.id || account.id === args.where.id);
    } },
    financeTransaction: { create: async ({ data }) => { financeEntry = data; return data; } },
    branchStock: { updateMany: async (args) => { stockUpdate = { ...args, where: args.where.AND?.[0] ?? args.where }; return { count: stockAvailable ? 1 : 0 }; } },
    order: { findFirst: async () => storedOrder, create: async (args) => {
      assert.deepEqual(args.include.organization, { select: { name: true } });
      createdOrder = args.data;
      return storedOrder = { ...args.data, id: "order-1", createdAt: new Date("2026-10-20T10:00:00Z"),
        organization: { name: "Veritabanındaki işletme" }, branch: { id: "branch-1", name: "Şube" },
        items: args.data.items.create.map((item) => ({ ...item, id: "item-1" })) };
    } },
    stockMovement: { create: async (args) => { movement = args.data; return args.data; } },
  }),
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/prisma") return { prisma };
  if (request === "@/lib/current-membership") return { getCurrentMembership: async () => ({ organizationId: "org-1", role: "OWNER", userId: "owner-1", allBranches: true, branchAccess: [] }) };
  if (request === "next/headers") return { cookies: async () => ({ get: () => ({ value: "branch-1" }) }) };
  if (request.startsWith("@/")) request = path.resolve(__dirname, "../src", request.slice(2));
  return load.call(this, request, parent, isMain);
};
const { POST } = require("../src/app/api/orders/route.ts");
Module._load = load;

function sell(discount, paymentMethod = "CASH", financeAccountId, key = crypto.randomUUID()) {
  return POST(new Request("http://localhost/api/orders", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchId: "branch-1", paymentMethod, discount, financeAccountId, idempotencyKey: key,
      // Duplicate entries must still merge; client prices must be ignored.
      items: [{ productId: "product-1", quantity: 1, price: 999 }, { productId: "product-1", quantity: 1.5, price: 999 }] }) }));
}

test("sale response contains database receipt details and preserves pricing, discount and stock operations", async () => {
  for (const [discount, total, method] of [
    [undefined, "60", "CASH"], [{ type: "PERCENT", value: 10 }, "54", "CARD"],
    [{ type: "FIXED", value: 5 }, "55", "CASH"], [{ type: "PERCENT", value: 100 }, "0", "CARD"],
  ]) {
    stockAvailable = true;
    financeEntry = undefined;
    const response = await sell(discount, method);
    assert.equal(response.status, 201);
    const { order } = await response.json();
    assert.equal(order.organization.name, "Veritabanındaki işletme");
    assert.equal(order.branch.name, "Şube");
    assert.equal(order.createdAt, "2026-10-20T10:00:00.000Z");
    assert.equal(order.total, total);
    assert.equal(order.subtotal, "60");
    assert.equal(order.paymentMethod, method);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, "2.5");
    assert.equal(order.items[0].unitPrice, "24");
    assert.equal(stockUpdate.where.organizationId, "org-1");
    assert.equal(stockUpdate.where.branchId, "branch-1");
    assert.ok(stockUpdate.data.quantity.decrement.eq(2.5));
    assert.equal(movement.type, "SALE");
    assert.equal(movement.reference, order.orderNumber);
    if (total === "0") {
      assert.equal(financeEntry, undefined);
    } else {
      assert.equal(financeQuery.where.type, method);
      assert.equal(financeEntry.accountId, "finance-1");
      assert.equal(financeEntry.orderId, order.id);
      assert.equal(financeEntry.source, "POS_SALE");
      assert.equal(financeEntry.direction, "IN");
      assert.ok(financeEntry.amount.eq(total));
      assert.ok(financeEntry.description.includes(order.orderNumber));
    }
  }
});

test("missing and ambiguous accounts fail before stock writes; an explicit valid account resolves ambiguity", async () => {
  for (const candidates of [[], [{ id: "finance-1" }, { id: "finance-2" }]]) {
    accounts = candidates;
    createdOrder = stockUpdate = movement = financeEntry = undefined;
    assert.equal((await sell()).status, 409);
    assert.equal(stockUpdate, undefined);
    assert.equal(createdOrder, undefined);
    assert.equal(financeEntry, undefined);
  }
  stockAvailable = true;
  assert.equal((await sell(undefined, "CASH", "finance-2")).status, 201);
  assert.equal(financeEntry.accountId, "finance-2");
  accounts = [{ id: "finance-1" }];
});

test("insufficient stock and invalid discounts cannot create an order", async () => {
  for (const [available, discount, status] of [[false, undefined, 409], [true, { type: "PERCENT", value: 101 }, 400], [true, { type: "FIXED", value: 61 }, 400]]) {
    stockAvailable = available;
    createdOrder = undefined;
    movement = undefined;
    assert.equal((await sell(discount)).status, status);
    assert.equal(createdOrder, undefined);
    assert.equal(movement, undefined);
  }
});

test("direct API sales reject ingredients, inactive products and another organization's products before stock changes", async () => {
  for (const [sellable, active, organization] of [[false, true, "org-1"], [true, false, "org-1"], [true, true, "org-other"]]) {
    productSellable = sellable;
    productActive = active;
    productOrganization = organization;
    createdOrder = movement = stockUpdate = undefined;
    assert.equal((await sell()).status, 400);
    assert.equal(createdOrder, undefined);
    assert.equal(movement, undefined);
    assert.equal(stockUpdate, undefined);
  }
  productSellable = productActive = true;
  productOrganization = "org-1";
});

test("retry returns the saved sale without consuming stock or cash again; changed payload conflicts", async () => {
  productSellable=true;productActive=true;productOrganization='org-1';stockAvailable=true;
  const key=crypto.randomUUID();assert.equal((await sell(undefined,'CASH',undefined,key)).status,201);
  createdOrder=stockUpdate=movement=financeEntry=undefined;
  const replay=await sell(undefined,'CASH',undefined,key);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal(stockUpdate,undefined);assert.equal(financeEntry,undefined);assert.equal(createdOrder,undefined);
  assert.equal((await sell({type:'FIXED',value:1},'CASH',undefined,key)).status,409);
});
