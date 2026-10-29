import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import InvoicesManager from "@/components/invoices/InvoicesManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("finance.manage");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="invoices" title="Faturalar" description="Alış ve satış belgelerinizi, cari bağlantılarını ve açık bakiyeleri takip edin."/><InvoicesManager/></main>;
}
