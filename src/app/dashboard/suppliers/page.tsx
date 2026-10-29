import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import SuppliersManager from "@/components/suppliers/SuppliersManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("suppliers.read");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="accounts" title="Tedarikçiler" description="Tedarikçi profillerini, ürünlerini ve alış faturalarını ve cari bağlantılarını tek yerden yönetin."/><SuppliersManager/></main>;
}
