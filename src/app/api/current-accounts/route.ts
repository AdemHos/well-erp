import { withPermission } from "@/lib/rbac";
import { listAccounts, createAccount } from "@/lib/current-accounts-service";
export const GET = withPermission("finance.manage", listAccounts);
export const POST = withPermission("finance.manage", createAccount);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
