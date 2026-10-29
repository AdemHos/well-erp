export const permissions = [
  "settings.read", "settings.organization.manage", "settings.branch.manage", "settings.policy.manage",
  "integrations.read", "integrations.manage",
  "qr-menu.manage", "service-requests.read", "service-requests.manage",
  "reports.read", "context", "catalog.read", "pos.sell", "orders.read", "orders.refund",
  "products.manage", "stock.manage", "recipes.manage", "production.manage",
  "suppliers.read", "suppliers.manage", "customers.read", "customers.manage", "customers.lookup", "finance.manage", "restaurant.read", "restaurant.manage", "restaurant.checkout",
  "tables.manage", "kitchen.read", "kitchen.manage", "branches.manage",
  "staff.read", "staff.manage", "ownership.manage", "audit.read",
] as const;
export type Permission = typeof permissions[number];
const operations: Permission[] = permissions.filter((permission) => !["settings.organization.manage", "settings.policy.manage", "integrations.manage", "staff.manage", "ownership.manage", "branches.manage"].includes(permission));
export const rolePermissions: Record<string, readonly Permission[]> = {
  OWNER: permissions,
  ADMIN: permissions.filter((permission) => permission !== "ownership.manage"),
  MANAGER: operations,
  CASHIER: ["settings.read", "service-requests.read", "customers.lookup", "context", "catalog.read", "pos.sell", "orders.read", "restaurant.read", "restaurant.checkout"],
  WAITER: ["settings.read", "service-requests.read", "service-requests.manage", "context", "catalog.read", "restaurant.read", "restaurant.manage"],
  KITCHEN: ["settings.read", "context", "kitchen.read", "kitchen.manage"],
  STAFF: ["settings.read", "context"],
};
export const hasPermission = (role: string, permission: Permission) => Object.hasOwn(rolePermissions, role) && rolePermissions[role].includes(permission);
export const canAssignRole = (actor: string, target: string) => Object.hasOwn(rolePermissions, target) && (actor === "OWNER" || (actor === "ADMIN" && target !== "OWNER" && target !== "ADMIN"));
export type BranchScope = { role: string; organizationId: string; allBranches?: boolean; branchAccess?: { branchId: string }[] };
export const hasAllBranches = (member: BranchScope) => member.role === "OWNER" || member.allBranches === true;
export const allowedBranchIds = (member: BranchScope) => (member.branchAccess ?? []).map((access) => access.branchId);
export const branchScope = (member: BranchScope) => hasAllBranches(member) ? {} : { branchId: { in: allowedBranchIds(member) } };
export const branchIdScope = (member: BranchScope) => hasAllBranches(member) ? {} : { id: { in: allowedBranchIds(member) } };
