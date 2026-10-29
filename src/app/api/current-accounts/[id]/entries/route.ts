import { withPermission } from "@/lib/rbac";
import { createAccountEntry } from "@/lib/current-accounts-service";
import { accountStatement } from "@/lib/current-account-statement";
export const GET = withPermission("finance.manage", accountStatement);
export const POST = withPermission("finance.manage", createAccountEntry);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
