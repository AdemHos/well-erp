import { requirePagePermission } from "@/lib/rbac";
import ExpenseDetail from "@/components/expenses/ExpenseDetail";
export const dynamic = "force-dynamic";
export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) { await requirePagePermission("finance.manage"); const { id } = await params; return <main className="space-y-6 p-4 md:p-6"><ExpenseDetail key={id} expenseId={id}/></main>; }
