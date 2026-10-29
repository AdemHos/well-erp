/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server route harness, no database connections. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => {
  const source = fs.readFileSync(file, "utf8").replaceAll("import.meta.url", JSON.stringify(require("node:url").pathToFileURL(file).href));
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
};
const { Prisma } = require("../src/generated/prisma/client.ts");
let state, role, tenant, branch, failFinance, salePresent, deletedProduct;
function reset() {
  state = { status: "COMPLETED", stock: 8, returns: 0, refunds: 0 };
  role = "OWNER"; tenant = "org-1"; branch = "branch-1";
  failFinance = false; salePresent = true; deletedProduct = false;
}
reset();
const inScope = (where) => where.id === "order-1" && where.organizationId === "org-1" && where.branchId === "branch-1";
const tx = {
  $queryRaw: async () => [{ ready: false }],
  auditLog: { create: async ({ data }) => data },
  order: {
    updateMany: async ({ where }) => {
      if (!inScope(where) || state.status !== where.status) return { count: 0 };
      state.status = "REFUNDED"; return { count: 1 };
    },
    findFirst: async ({ where }) => inScope(where) ? { id: "order-1", status: state.status } : null,
    findFirstOrThrow: async () => ({
      id: "order-1", orderNumber: "POS-1", organizationId: "org-1", branchId: "branch-1", status: state.status,
      total: new Prisma.Decimal(90), items: [{ productId: deletedProduct ? null : "p1", quantity: new Prisma.Decimal(2) }],
      financeTransactions: salePresent ? [{ source: "POS_SALE", direction: "IN", amount: new Prisma.Decimal(90), accountId: "original-account",
        organizationId: "org-1", branchId: "branch-1", account: { id: "original-account", organizationId: "org-1", branchId: "branch-1", openingBalance: new Prisma.Decimal(1000), isActive: false } }] : [],
    }),
  },
  product: { findMany: async () => [{ id: "p1" }] },
  branchStock: { upsert: async ({ update }) => { state.stock += update.quantity.increment.toNumber(); return { organizationId: "org-1" }; } },
  stockMovement: { create: async ({ data }) => { assert.equal(data.type, "RETURN"); assert(data.quantity.eq(2)); state.returns++; } },
  financeTransaction: { groupBy: async () => [], create: async ({ data }) => {
    if (failFinance) throw new Error("Injected failure");
    assert.equal(data.source, "POS_REFUND"); assert.equal(data.direction, "OUT");
    assert.equal(data.accountId, "original-account"); assert(data.amount.eq(90)); state.refunds++;
  } },
};
let lock = Promise.resolve();
const prisma = {
  $queryRaw: async () => [{ ready: false }],
  branch: { findFirst: async () => ({ id: branch }) },
  order: tx.order,
  // Model PostgreSQL's serial row-lock acquisition and rollback for concurrent calls.
  $transaction: (callback) => {
    const run = lock.then(async () => {
      const before = { ...state };
      try { return await callback(tx); } catch (error) { state = before; throw error; }
    });
    lock = run.catch(() => {});
    return run;
  },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/prisma") return { prisma };
  if (request === "@/lib/current-membership") return { getCurrentMembership: async () => role ? { role, organizationId: tenant, userId: "manager-1", allBranches: true, branchAccess: [] } : null };
  if (request === "next/headers") return { cookies: async () => ({ get: () => ({ value: branch }) }) };
  if (request.startsWith("@/")) request = path.resolve(__dirname, "../src", request.slice(2));
  return load.call(this, request, parent, isMain);
};
const { POST } = require("../src/app/api/orders/[id]/refund/route.ts");
const { PATCH, GET: detail } = require("../src/app/api/orders/[id]/route.ts");
const { GET: history } = require("../src/app/api/orders/route.ts");
Module._load = load;
const request = () => new Request("http://localhost/api/orders/order-1/refund", { method: "POST", body: JSON.stringify({ amount: 99999, quantity: 99999 }) });
const context = () => ({ params: Promise.resolve({ id: "order-1" }) });

test("full refund trusts saved amount and quantities, including inactive original accounts", async () => {
  reset();
  assert.equal((await POST(request(), context())).status, 200);
  assert.deepEqual(state, { status: "REFUNDED", stock: 10, returns: 1, refunds: 1 });
  assert.equal((await POST(request(), context())).status, 409);
  assert.equal(state.stock, 10);
});

test("two concurrent requests produce exactly one successful refund", async () => {
  reset();
  const results = await Promise.all([POST(request(), context()), POST(request(), context())]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.deepEqual(state, { status: "REFUNDED", stock: 10, returns: 1, refunds: 1 });
});

test("cashiers, unauthenticated users, foreign tenants and branches cannot refund", async () => {
  for (const [userRole, userTenant, userBranch, status] of [[null, "org-1", "branch-1", 401], ["CASHIER", "org-1", "branch-1", 403], ["OWNER", "other-org", "branch-1", 404], ["OWNER", "org-1", "other-branch", 404]]) {
    reset(); role = userRole; tenant = userTenant; branch = userBranch;
    const before = { ...state };
    assert.equal((await POST(request(), context())).status, status);
    assert.deepEqual(state, before);
  }
});

test("finance failures roll back status, stock and return movements", async () => {
  reset(); failFinance = true;
  const before = { ...state }, log = console.error;
  console.error = () => {};
  try { assert.equal((await POST(request(), context())).status, 500); } finally { console.error = log; }
  assert.deepEqual(state, before);
});

test("legacy sales without finance and deleted products fail safely", async () => {
  for (const reason of ["finance", "product"]) {
    reset(); salePresent = reason !== "finance"; deletedProduct = reason === "product";
    const before = { ...state };
    assert.equal((await POST(request(), context())).status, 409);
    assert.deepEqual(state, before);
  }
});

test("status-only cancellation of a completed sale is blocked", async () => {
  reset();
  assert.equal((await PATCH(request(), context())).status, 409);
  assert.equal(state.status, "COMPLETED");
});

test("admin and manager may refund; a cancelled order cannot be refunded", async () => {
  for (const allowed of ["ADMIN", "MANAGER"]) {
    reset(); role = allowed;
    assert.equal((await POST(request(), context())).status, 200);
  }
  reset(); state.status = "CANCELLED";
  const before = { ...state };
  assert.equal((await POST(request(), context())).status, 409);
  assert.deepEqual(state, before);
});

test("history and detail endpoints reject unauthenticated access", async () => {
  reset(); role = null;
  assert.equal((await history(new Request("http://localhost/api/orders"))).status, 401);
  assert.equal((await detail(request(), context())).status, 401);
});
