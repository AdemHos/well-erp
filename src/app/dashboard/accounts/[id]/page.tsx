import { requirePagePermission } from "@/lib/rbac";
import CurrentAccountDetail from "@/components/current-accounts/CurrentAccountDetail";
export const dynamic = "force-dynamic";
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("finance.manage");
  const { id } = await params;
  return <main className="space-y-6 p-4 md:p-6"><CurrentAccountDetail key={id} accountId={id}/></main>;
}
