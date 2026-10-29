import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import CurrentAccountsManager from "@/components/current-accounts/CurrentAccountsManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("finance.manage");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="accounts" title="Cari Hesaplar" description="Müşteri ve tedarikçi bakiyelerini, açılışlarını ve cari ekstrelerini yönetin."/><CurrentAccountsManager/></main>;
}
