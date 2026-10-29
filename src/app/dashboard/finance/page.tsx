import { FinanceHeading } from "@/components/finance/finance-ui";
import FinanceObligations from "@/components/payments/FinanceObligations";
import { hasPermission } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import FinanceManager from "@/components/finance/FinanceManager";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const membership = await requirePagePermission("finance.manage");

  if (!membership) {
    redirect("/login");
  }

  return (
    <main className="space-y-6 p-4 md:p-6">
      <FinanceHeading section="finance" title="Kasa ve Finans" description="Şube hesaplarınızı, para giriş ve çıkışlarını tek bakışta takip edin."/>

      <FinanceObligations/>
      <FinanceManager
        canManage={hasPermission(membership.role, "finance.manage")}
      />
    </main>
  );
}
