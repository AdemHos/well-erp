import { branchIdScope, hasPermission } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import TableManager from "@/components/restaurant/TableManager";
import ServiceRequestsPanel from "@/components/restaurant/ServiceRequestsPanel";
import FinanceLayout from "@/components/finance/FinanceLayout";

export default async function TablesPage() {
  // 1. Kullanıcının işletme üyeliğini kontrol et
  const membership = await requirePagePermission("restaurant.read");

  if (!membership) {
    redirect("/onboarding");
  }

  // 2. İşletmeye ait şubeleri getir
  const branches = await prisma.branch.findMany({
    where: { AND: [{
      organizationId: membership.organizationId,
    }, branchIdScope(membership)] },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  // 3. Dashboard'da seçilen aktif şubeyi oku
  const cookieStore = await cookies();

  const savedBranchId = cookieStore.get(
    "wellpos-active-branch"
  )?.value;

  // 4. Cookie'deki şubenin işletmeye ait olduğunu doğrula
  // Geçersizse ilk şubeyi kullan
  const activeBranch =
    branches.find(
      (branch) => branch.id === savedBranchId
    ) ?? branches[0];

  // 5. İşletmenin hiç şubesi yoksa bilgilendir
  if (!activeBranch) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">
          Şube Bulunamadı
        </h2>

        <p className="mt-2 text-sm text-amber-700">
          İşletmenize ait herhangi bir şube bulunamadı.
          Masa yönetimini kullanabilmek için önce bir şube
          oluşturmanız gerekiyor.
        </p>
      </div>
    );
  }

  // 6. Aktif şubeyi masa yönetimine aktar
  return (
    <div className="space-y-6">
    {hasPermission(membership.role, "service-requests.read") && <FinanceLayout><ServiceRequestsPanel key={activeBranch.id + "-requests"} branchId={activeBranch.id} canManage={hasPermission(membership.role, "service-requests.manage")}/></FinanceLayout>}
    <TableManager
      key={activeBranch.id}
      branchId={activeBranch.id}
      canManage={hasPermission(membership.role, "tables.manage")}
      canOperate={hasPermission(membership.role, "restaurant.manage")}
      financeAccounts={hasPermission(membership.role, "restaurant.checkout") ? await prisma.financeAccount.findMany({ where: { organizationId: membership.organizationId, branchId: activeBranch.id, isActive: true, type: { in: ["CASH", "CARD"] } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }) : []}
      canCheckout={hasPermission(membership.role, "restaurant.checkout")}
    />
    </div>
  );
}
