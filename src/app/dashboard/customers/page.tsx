import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import CustomersManager from "@/components/customers/CustomersManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("customers.read");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="accounts" title="Müşteriler" description="Müşteri profillerini, alışveriş geçmişini ve cari bağlantılarını tek yerden yönetin."/><CustomersManager/></main>;
}
