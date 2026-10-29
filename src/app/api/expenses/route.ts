import { withPermission } from "@/lib/rbac";
import { createExpense } from "@/lib/expense-service";
import { listExpenses } from "@/lib/expense-read";
export const GET = withPermission("finance.manage", listExpenses);
export const POST = withPermission("finance.manage", createExpense);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
