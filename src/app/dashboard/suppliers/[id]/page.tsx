import { requirePagePermission } from "@/lib/rbac";
import SupplierDetail from "@/components/suppliers/SupplierDetail";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("suppliers.read");
  const { id } = await params;
  return <main className="p-4 md:p-6"><SupplierDetail key={id} id={id}/></main>;
}
