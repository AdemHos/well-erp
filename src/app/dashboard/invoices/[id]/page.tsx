import InvoiceDetail from "@/components/invoices/InvoiceDetail";
import { requirePagePermission } from "@/lib/rbac";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){await requirePagePermission("finance.manage");const {id}=await params;return <main className="space-y-6 p-4 md:p-6"><h1 className="text-2xl font-bold">Fatura detayı</h1><InvoiceDetail id={id}/></main>}