import { withPermission } from "@/lib/rbac";
import { reverseAccountEntry } from "@/lib/current-accounts-service";
export const POST = withPermission("finance.manage", reverseAccountEntry);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
