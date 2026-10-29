import { withPermission } from "@/lib/rbac";
import { getExpense, updateExpense } from "@/lib/expense-service";
export const GET = withPermission("finance.manage", getExpense);
export const PATCH = withPermission("finance.manage", updateExpense);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
