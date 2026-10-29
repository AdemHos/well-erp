import { requirePagePermission } from "@/lib/rbac";
import { FinanceHeading } from "@/components/finance/finance-ui";
import ReportsManager from "@/components/reports/ReportsManager";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("reports.read");
  return <main className="space-y-6 p-4 md:p-6"><FinanceHeading section="accounts" title="Raporlar ve Analitik" description="Gerçek satış, finans ve stok kayıtlarından; yetkili şubeler ve açık hesaplama kurallarıyla."/><ReportsManager/></main>;
}
