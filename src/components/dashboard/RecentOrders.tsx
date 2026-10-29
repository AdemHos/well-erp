import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DashboardOrder } from "@/lib/dashboard-data";
const labels: Record<string, string> = { COMPLETED: "Tamamlandı", REFUNDED: "İade edildi", CANCELLED: "İptal edildi" };
export default function RecentOrders({ orders }: { orders: DashboardOrder[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-100 p-5">
      <div><h2 className="font-semibold text-slate-950">Son Siparişler</h2><p className="mt-1 text-sm text-slate-500">Seçili şubenin son satışları.</p></div>
      <Link href="/dashboard/orders" className="flex items-center gap-1 text-xs font-semibold text-blue-600">Tümünü Gör <ArrowRight size={14}/></Link>
    </div>
    {!orders.length && <p className="p-6 text-sm text-slate-500">Bu şubede henüz satış bulunmuyor.</p>}
    <div className="divide-y divide-slate-100">{orders.map(order => <div key={order.id} className="flex flex-wrap items-center gap-3 p-5">
      <div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold text-slate-900">{order.orderNumber}</p>
        <p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }).format(new Date(order.createdAt))} · {order.paymentMethod === "CASH" ? "Nakit" : "Kart"}</p></div>
      <p className="text-sm font-semibold text-slate-900">{new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(order.total))}</p>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{labels[order.status] ?? order.status}</span>
    </div>)}</div>
  </section>;
}
