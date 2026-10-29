/* eslint-disable @typescript-eslint/no-require-imports -- Test the CommonJS-transpiled server module without opening database connections. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");

test("hot reload replaces a stale Prisma client and reuses a matching client", () => {
  const previousClient = globalThis.prisma;
  const previousConstructor = globalThis.prismaConstructor;
  const load = Module._load;
  const filename = require.resolve("../src/lib/prisma.ts");
  let created = 0;
  class Client { constructor() { this.instance = ++created; } }
  let generatedClient = Client;
  Module._load = function (request, parent, isMain) {
    if (request === "@/generated/prisma/client") return { PrismaClient: generatedClient };
    if (request === "@prisma/adapter-pg") return { PrismaPg: class {} };
    return load.call(this, request, parent, isMain);
  };
  require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  const reload = () => { delete require.cache[filename]; return require(filename).prisma; };
  try {
    const stale = { instance: "before-generation" };
    globalThis.prisma = stale;
    delete globalThis.prismaConstructor;
    const current = reload();
    assert.notEqual(current, stale);
    assert.equal(reload(), current);
    assert.equal(created, 1);
    generatedClient = class RegeneratedClient extends Client {};
    const regenerated = reload();
    assert.notEqual(regenerated, current);
    assert.equal(reload(), regenerated);
    assert.equal(created, 2);
  } finally {
    Module._load = load;
    globalThis.prisma = previousClient;
    globalThis.prismaConstructor = previousConstructor;
    delete require.cache[filename];
  }
});
