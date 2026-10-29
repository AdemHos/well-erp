import { AccessError } from "@/lib/auth-context";
import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchIdScope } from "@/lib/permissions";
import Sidebar from "@/components/dashboard/Sidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import LogoutButton from "@/components/landing/auth/LogoutButton";
import OrganizationSelector from "@/components/dashboard/OrganizationSelector";
import DashboardTheme from "@/components/settings/DashboardTheme";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  const membership = await getCurrentMembership().catch((error: unknown) => { if (error instanceof AccessError) { if (error.status === 428) redirect("/profiles"); if (error.status === 401) redirect("/login"); } throw error; });
  if (!membership) {
    const count = await prisma.membership.count({ where: { user: { email: session.user.email } } });
    if (!count) redirect("/onboarding");
    const choices = await prisma.membership.findMany({ where: { user: { email: session.user.email }, isActive: true }, select: { organizationId: true, organization: { select: { name: true } } } });
    return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-bold">Seçili işletmeye erişiminiz yok</h1><p>İşletme yöneticinizden üyeliğinizi etkinleştirmesini veya yeni bir davet bağlantısı isteyin.</p>{choices.length > 0 && <OrganizationSelector activeId="" organizations={choices.map((choice) => ({ id: choice.organizationId, name: choice.organization.name }))} />}<Link href="/invite" className="block underline">Davet bilgileri</Link><LogoutButton /></main>;
  }
  const [branches, memberships] = await Promise.all([
    prisma.branch.findMany({ where: { organizationId: membership.organizationId, ...branchIdScope(membership) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.membership.findMany({ where: { userId: membership.userId, isActive: true }, select: { organizationId: true, organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const saved = (await cookies()).get("wellpos-active-branch")?.value;
  const activeBranch = branches.find((branch) => branch.id === saved) ?? branches[0];
  return <DashboardTheme key={membership.userId} userId={membership.userId}><Sidebar role={membership.role} />
    <DashboardHeader user={membership.user} role={membership.role} organizationName={membership.organization.name}
      organizations={memberships.map((member) => ({ id: member.organizationId, name: member.organization.name }))}
      activeOrganizationId={membership.organizationId} branches={branches} activeBranchId={activeBranch?.id ?? null} />
    <main className="min-h-screen pt-20 md:pl-64"><div className="p-4 md:p-8">{children}</div></main></DashboardTheme>;
}
