import { hasPermission, hasAllBranches } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/rbac";

import { redirect } from "next/navigation";
import BranchManager from "@/components/branches/BranchManager";

export default async function BranchesPage() {
  const membership = await requirePagePermission("context");

  if (!membership) {
    redirect("/onboarding");
  }

  const canManage = hasPermission(membership.role, "branches.manage");

  return <BranchManager canManage={canManage} canCreate={canManage && hasAllBranches(membership)} />;
}
