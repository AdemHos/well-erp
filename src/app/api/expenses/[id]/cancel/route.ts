import { withPermission } from "@/lib/rbac";
import { cancelExpense } from "@/lib/expense-service";
export const POST = withPermission("finance.manage", cancelExpense);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
