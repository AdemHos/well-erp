import { requirePagePermission } from "@/lib/rbac";
import InvoicePreview from "@/components/invoices/InvoicePreview";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requirePagePermission("finance.manage"); const { id } = await params; return <main className="p-4 md:p-6"><InvoicePreview id={id}/></main>; }
