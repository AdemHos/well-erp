import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import PaymentsManager from "@/components/payments/PaymentsManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("finance.manage");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="payments" title="Ödemeler ve Tahsilatlar" description="Tahsilatlarınızı ve ödemelerinizi aynı yerden yönetin; kasa ve cari hareketlerini birlikte izleyin."/><PaymentsManager/></main>;
}
