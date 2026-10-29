/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free TypeScript test harness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { hasPermission, canAssignRole, branchScope, branchIdScope } = require("../src/lib/permissions.ts");
test("cashiers may sell and read sales but cannot manage finance or refunds", () => {
  assert(hasPermission("CASHIER", "pos.sell")); assert(hasPermission("CASHIER", "orders.read"));
  for (const permission of ["finance.manage", "orders.refund", "products.manage", "staff.manage"]) assert.equal(hasPermission("CASHIER", permission), false);
});
test("waiters manage restaurant orders, not payments, kitchen state or finance", () => {
  assert(hasPermission("WAITER", "restaurant.manage")); assert(hasPermission("WAITER", "catalog.read"));
  for (const permission of ["pos.sell", "finance.manage", "restaurant.checkout", "kitchen.manage"]) assert.equal(hasPermission("WAITER", permission), false);
});
test("kitchen and staff permissions are limited; unknown roles fail closed", () => {
  assert(hasPermission("KITCHEN", "kitchen.read")); assert(hasPermission("KITCHEN", "kitchen.manage"));
  for (const role of ["KITCHEN", "STAFF", "unknown", "__proto__", "constructor"]) for (const permission of ["pos.sell", "finance.manage", "staff.manage"]) assert.equal(hasPermission(role, permission), false);
});
test("ownership and administrator grants cannot be escalated by administrators", () => {
  assert(canAssignRole("OWNER", "OWNER")); assert(canAssignRole("ADMIN", "MANAGER"));
  for (const [actor, target] of [["ADMIN", "OWNER"], ["ADMIN", "ADMIN"], ["MANAGER", "CASHIER"], ["CASHIER", "OWNER"], ["OWNER", "__proto__"]]) assert.equal(canAssignRole(actor, target), false);
});
test("branch scopes fail closed and preserve existing all-branch memberships", () => {
  const member = { role: "CASHIER", organizationId: "org", allBranches: false, branchAccess: [{ branchId: "A" }] };
  assert.deepEqual(branchScope(member), { branchId: { in: ["A"] } });
  assert.deepEqual(branchIdScope({ ...member, branchAccess: [] }), { id: { in: [] } });
  assert.deepEqual(branchScope({ ...member, allBranches: true }), {});
  assert.deepEqual(branchScope({ ...member, role: "OWNER" }), {});
});
test("all operational API entrypoints require the central permission wrapper", () => {
  // This one public QR endpoint authenticates the physical QR bearer token,
  // not a staff session. Its independent security path is checked below and
  // with real DB integration tests; no other /menu endpoint is exempted.
  const exempt = new Set(["menu/[token]/requests", "auth/[...nextauth]", "auth/register", "onboarding", "uploadthing", "users", "organizations", "organizations/active", "staff/invitations/accept", "profile-session"]);
  function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? files(dir + "/" + item.name) : [dir + "/" + item.name]); }
  for (const file of files("src/app/api").filter((file) => file.endsWith("/route.ts"))) {
    const relative = file.replace("src/app/api/", "").replace("/route.ts", "");
    if (exempt.has(relative)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement) && ["GET", "POST", "PATCH", "DELETE", "PUT"].includes(statement.name?.text)) assert.fail(`${file} exports an unguarded handler`);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!["GET", "POST", "PATCH", "DELETE", "PUT"].includes(declaration.name.getText(source))) continue;
        assert(ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === "withPermission", file);
      }
    }
  }
});

test("the public QR endpoint exposes POST only and applies origin/rate guard before token-bound creation", () => {
  const file = "src/app/api/menu/[token]/requests/route.ts", text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const verbs = source.statements.filter(s => s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && ts.isFunctionDeclaration(s)).map(s => s.name?.text);
  assert.deepEqual(verbs, ["POST"]);
  assert(text.indexOf("publicRequestGuard(request)") < text.indexOf("await createPublicRequest("));
  assert(text.includes("await qrBody(request)"));
  assert(text.includes("qrError(e)"));
});


test("customer management stays separate from the cashier's narrow POS lookup", () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) for (const permission of ["customers.read", "customers.manage", "customers.lookup"]) assert(hasPermission(role, permission));
  assert(hasPermission("CASHIER", "customers.lookup"));
  for (const permission of ["customers.read", "customers.manage", "finance.manage"]) assert.equal(hasPermission("CASHIER", permission), false);
  for (const role of ["WAITER", "KITCHEN", "STAFF", "unknown"]) for (const permission of ["customers.read", "customers.manage", "customers.lookup"]) assert.equal(hasPermission(role, permission), false);
});
