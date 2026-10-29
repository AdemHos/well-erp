import { requirePagePermission } from "@/lib/rbac";
import CustomerDetail from "@/components/customers/CustomerDetail";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("customers.read");
  const { id } = await params;
  return <main className="p-4 md:p-6"><CustomerDetail key={id} id={id}/></main>;
}
