/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server route security test. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
let session = null;
let exists = true;
let queries = 0;
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/auth") return { auth: async () => session };
  if (request === "@/lib/prisma") return { prisma: { user: { findUnique: async (args) => {
    queries++;
    assert.equal(args.where.email, "person@example.test");
    assert.deepEqual(args.select, { id: true, name: true, email: true, image: true });
    return exists ? { id: "user-1", name: "Person", email: "person@example.test", image: null } : null;
  } } } };
  return load.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { GET } = require("../src/app/api/users/route.ts");
Module._load = load;

test("users API rejects anonymous requests without querying account data", async () => {
  assert.equal((await GET()).status, 401);
  assert.equal(queries, 0);
});
test("users API returns only the authenticated user's selected profile fields", async () => {
  session = { user: { email: "person@example.test" } };
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.user).sort(), ["email", "id", "image", "name"]);
  assert.equal(body.account, undefined);
});
test("a missing authenticated user returns 404", async () => {
  exists = false;
  assert.equal((await GET()).status, 404);
});
