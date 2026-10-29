import Link from "next/link";
import { requirePagePermission } from "@/lib/rbac";
import { hasPermission, type Permission } from "@/lib/permissions";
import { AlertTriangle, ReceiptText, ShoppingBag, Wallet, ShoppingCart, ClipboardList, Utensils, ChefHat, type LucideIcon } from "lucide-react";



import StatCard from "@/components/dashboard/StatCard";
import SalesChart from "@/components/dashboard/SalesChart";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentOrders from "@/components/dashboard/RecentOrders";
import StockAlerts from "@/components/dashboard/StockAlerts";
import { criticalStockAlerts } from "@/lib/stock-alerts";
import { loadDashboard } from "@/lib/dashboard-data";
import AiAssistant from "@/components/dashboard/AiAssistant";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const membership = await requirePagePermission("context");

  if (!hasPermission(membership.role, "finance.manage")) {
    const cards: { href: string; label: string; permission: Permission; icon: LucideIcon; color: string }[] = [
      { href: "/dashboard/pos", label: "POS Satışı", permission: "pos.sell", icon: ShoppingCart, color: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500" },
      { href: "/dashboard/orders", label: "Satış Geçmişi", permission: "orders.read", icon: ClipboardList, color: "bg-emerald-700 hover:bg-emerald-800 focus-visible:ring-emerald-600" },
      { href: "/dashboard/tables", label: "Masalar ve Adisyonlar", permission: "restaurant.read", icon: Utensils, color: "bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500" },
      { href: "/dashboard/kitchen", label: "Mutfak Siparişleri", permission: "kitchen.read", icon: ChefHat, color: "bg-orange-700 hover:bg-orange-800 focus-visible:ring-orange-600" },
    ];
    return (
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hoş geldiniz, {membership.user.name ?? "Kullanıcı"}</h1>
          <p className="mt-2 text-sm text-slate-600">İzinli şubelerinizi üst menüden seçebilirsiniz. Erişim değişikliği için işletme yöneticinize başvurun.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {cards.filter((card) => hasPermission(membership.role, card.permission)).map(({ href, label, icon: Icon, color }) => (
            <Link key={href} href={href} className={`group flex min-h-48 flex-col items-center justify-center gap-5 rounded-2xl p-6 text-center text-white shadow-sm outline-none transition duration-200 hover:shadow-lg focus-visible:ring-4 focus-visible:ring-offset-2 motion-safe:hover:-translate-y-1 ${color}`}>
              <Icon size={48} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              <span className="text-lg font-semibold">{label}</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  const firstName = membership.user.name?.split(" ")[0] || "Kullanıcı";
  const [stockAlerts, dashboard] = await Promise.all([criticalStockAlerts(), loadDashboard(membership)]);
  const money = (value: string) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(value));

  return (
    <div>
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-950">
          Hoş geldiniz, {firstName} 
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Seçili şubenizin bugünkü net satışları · İstanbul saati. İadeler ilk satış döneminden düşülür.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Bugünkü Satış"
          value={money(dashboard.total)}
          change={dashboard.changes.total}
          description="Tamamlanmış satışlar"
          icon={Wallet}
        />

        <StatCard
          title="Siparişler"
          value={String(dashboard.count)}
          change={dashboard.changes.count}
          description="Bugün tamamlanan satışlar"
          icon={ReceiptText}
        />

        <StatCard
          title="Ortalama Sepet"
          value={money(dashboard.average)}
          change={dashboard.changes.average}
          description="Net satış / tamamlanan satış"
          icon={ShoppingBag}
        />

        <StatCard
          title="Kritik Stok"
          value={stockAlerts.enabled ? `${stockAlerts.total} ürün` : "Kapalı"}
          actionText="Stokları kontrol et"
          actionHref="/dashboard/stock"
          icon={AlertTriangle}
        />
      </div>

      <AiAssistant key={dashboard.branchId ?? "no-branch"} provider={process.env.AI_PROVIDER?.trim() === "gemini" ? "gemini" : "openai"} />
      {/* Sales Chart + Quick Actions */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SalesChart charts={dashboard.charts} />
        </div>

        <div>
          <QuickActions />
        </div>
        
      </div>
      {/* Recent Orders + Stock Alerts */}
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <RecentOrders orders={dashboard.orders} />
          </div>

          <div>
            <StockAlerts result={stockAlerts} />
          </div>
        </div>
    </div>
  );
}
