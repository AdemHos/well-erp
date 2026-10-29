import { branchIdScope } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import KitchenManager from "@/components/restaurant/KitchenManager";

export default async function KitchenPage() {
  const membership = await requirePagePermission("kitchen.read");

  if (!membership) {
    redirect("/login");
  }

  const branches = await prisma.branch.findMany({
    where: { AND: [{
      organizationId: membership.organizationId,
    }, branchIdScope(membership)] },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
    },
  });

  const cookieStore = await cookies();

  const savedBranchId = cookieStore.get(
    "wellpos-active-branch"
  )?.value;

  const activeBranch =
    branches.find((branch) => branch.id === savedBranchId) ??
    branches[0];

  if (!activeBranch) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
        İşletmenize ait bir şube bulunamadı.
      </div>
    );
  }

  return <KitchenManager key={activeBranch.id} branchId={activeBranch.id} />;
}
