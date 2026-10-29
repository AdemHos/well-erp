import { withPermission } from "@/lib/rbac";
import { getAccount, updateAccount } from "@/lib/current-accounts-service";
export const GET = withPermission("finance.manage", getAccount);
export const PATCH = withPermission("finance.manage", updateAccount);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
