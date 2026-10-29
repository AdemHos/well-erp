import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import ExpensesManager from "@/components/expenses/ExpensesManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("finance.manage");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="expenses" title="Giderler" description="Giderleri, tedarikçi borçlarını ve gider ödemelerini takip edin."/><ExpensesManager/></main>;
}
