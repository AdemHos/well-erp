import { withPermission } from "@/lib/rbac";
import { payExpense, getExpense } from "@/lib/expense-service";
export const GET = withPermission("finance.manage", getExpense);
export const POST = withPermission("finance.manage", payExpense);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
