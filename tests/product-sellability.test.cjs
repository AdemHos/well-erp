/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS harness for server routes without database writes. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require.extensions[".ts"] = require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);

let saved = { id: "p1", organizationId: "org-1", name: "Un", price: 0, isActive: true, isSellable: false };
let writeCount = 0;
const prisma = {
  financeAccount: { findMany: async () => [] },
  category: { findMany: async () => [] },
  branch: { findMany: async () => [{ id: "branch-1", name: "Şube" }] },
  recipe: { findMany: async () => [] },
  product: {
  findFirst: async ({ where }) => where.id === saved.id && where.organizationId === saved.organizationId ? saved : null,
  findMany: async ({ where }) => where.organizationId === saved.organizationId &&
    (where.isActive !== true || saved.isActive) && (where.isSellable !== true || saved.isSellable) ? [saved] : [],
  create: async ({ data }) => { writeCount++; saved = { ...saved, ...data }; return saved; },
  update: async ({ data }) => { writeCount++; saved = { ...saved, ...data }; return saved; },
} };
prisma.auditLog = { create: async ({ data }) => data };
prisma.$transaction = async work => work(prisma);
prisma.stockMovement = { count: async () => 0 };
prisma.branchStock = { count: async () => 0 };
prisma.recipeItem = { count: async () => 0 };
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/prisma") return { prisma };
  if (request === "@/lib/current-membership") return { getCurrentMembership: async () => ({ organizationId: "org-1", role: "OWNER", userId: "owner-1", allBranches: true, branchAccess: [] }) };
  if (request === "next/headers") return { cookies: async () => ({ get: () => ({ value: "branch-1" }) }) };
  if (request === "next/navigation") return { redirect: () => { throw new Error("Unexpected redirect"); } };
  if (request === "@/components/pos/POSManager") return { __esModule: true, default: "pos-manager" };
  if (request === "@/components/recipes/RecipeManager") return { __esModule: true, default: "recipe-manager" };
  if (request === "@/generated/prisma/client") return { Prisma: { Decimal: class {} } };
  if (request.startsWith("@/")) request = path.resolve(__dirname, "../src", request.slice(2));
  return load.call(this, request, parent, isMain);
};
const { POST, GET } = require("../src/app/api/products/route.ts");
const { PATCH, DELETE } = require("../src/app/api/products/[id]/route.ts");
const { default: POSPage } = require("../src/app/dashboard/pos/page.tsx");
const { default: RecipesPage } = require("../src/app/dashboard/recipes/page.tsx");
Module._load = load;
const context = (id = "p1") => ({ params: Promise.resolve({ id }) });
const request = (body) => new Request("http://localhost/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Un", price: 0, isActive: true, ...body }) });

test("creation defaults to sellable and explicitly accepts an active ingredient", async () => {
  assert.equal((await POST(request({}))).status, 201);
  assert.equal(saved.isSellable, true);
  assert.equal((await POST(request({ isSellable: false }))).status, 201);
  assert.equal(saved.isSellable, false);
  assert.equal(saved.isActive, true);
  const { products } = await (await GET()).json();
  assert.equal(products.length, 1, "General catalog must retain ingredients for inventory and recipes");
  assert.equal(products[0].isSellable, false);
});

test("editing preserves omitted availability and supports switching both ways", async () => {
  saved.isSellable = false;
  assert.equal((await PATCH(request({ name: "Yeni un" }), context())).status, 200);
  assert.equal(saved.isSellable, false);
  for (const value of [true, false]) {
    assert.equal((await PATCH(request({ isSellable: value }), context())).status, 200);
    assert.equal(saved.isSellable, value);
  }
});

test("non-boolean availability is rejected without writes", async () => {
  for (const value of ["false", 0, null, {}, []]) {
    const before = writeCount;
    assert.equal((await POST(request({ isSellable: value }))).status, 400);
    assert.equal((await PATCH(request({ isSellable: value }), context())).status, 400);
    assert.equal(writeCount, before);
  }
});

test("another organization's product cannot be modified", async () => {
  const before = writeCount;
  saved.organizationId = "org-other";
  assert.equal((await PATCH(request({ isSellable: true }), context())).status, 404);
  assert.equal(writeCount, before);
  saved.organizationId = "org-1";
});

test("POS page excludes active ingredients and still includes sellable products", async () => {
  saved.isActive = true;
  saved.isSellable = false;
  assert.equal((await POSPage()).props.products.length, 0);
  saved.isSellable = true;
  assert.equal((await POSPage()).props.products.length, 1);
  saved.isActive = false;
  assert.equal((await POSPage()).props.products.length, 0);
  saved.isActive = true;
});

test("an active non-sellable ingredient remains selectable in recipe management", async () => {
  saved.isSellable = false;
  const page = await RecipesPage();
  function findManager(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "recipe-manager") return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findManager(child);
      if (found) return found;
    }
    return null;
  }
  const manager = findManager(page);
  assert.ok(manager, "Recipe manager must render");
  assert.equal(manager.props.products.length, 1);
  assert.equal(manager.props.products[0].id, saved.id);
});

test("archive preserves the product identity and history instead of deleting it",async()=>{
  saved.isActive=true;saved.isSellable=true;
  assert.equal((await DELETE(new Request("http://localhost/api/products/p1", { method: "DELETE" }),context())).status,200);
  assert.equal(saved.id,'p1');assert.equal(saved.isActive,false);assert.equal(saved.isSellable,false);
});
test("product units are validated and retained; existing inventory prevents unit reinterpretation",async()=>{
  assert.equal((await POST(request({unit:'KILOGRAM'}))).status,201);assert.equal(saved.unit,'KILOGRAM');
  assert.equal((await POST(request({unit:'INVALID'}))).status,400);
  prisma.stockMovement.count=async()=>1;
  assert.equal((await PATCH(request({unit:'GRAM'}),context())).status,409);assert.equal(saved.unit,'KILOGRAM');
  prisma.stockMovement.count=async()=>0;
});
