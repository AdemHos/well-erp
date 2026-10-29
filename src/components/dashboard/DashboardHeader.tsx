
import ProfileMenu from "./ProfileMenu";
import { Bell, Store } from "lucide-react";


import BranchSelector from "./BranchSelector";
import OrganizationSelector from "./OrganizationSelector";
import Link from "next/link";
import { hasPermission, type Permission } from "@/lib/permissions";

type Branch = {
  id: string;
  name: string;
};

type DashboardHeaderProps = {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  organizationName: string;
  branches: Branch[];
  activeBranchId: string | null;
  role: string;
  organizations: { id: string; name: string }[];
  activeOrganizationId: string;
};

export default function DashboardHeader({
  user,
  organizationName,
  branches,
  activeBranchId,
  role, organizations, activeOrganizationId,
}: DashboardHeaderProps) {
  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex min-h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 md:left-64 md:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Store size={18} />
        </div>

        <div>
          {organizations.length > 1 ? <OrganizationSelector organizations={organizations} activeId={activeOrganizationId} /> : <p className="max-w-40 truncate text-sm font-semibold text-slate-900">{organizationName}</p>}

          <BranchSelector
            branches={branches}
            activeBranchId={activeBranchId}
          />
        </div>
      </div>

      <details className="relative md:hidden"><summary className="cursor-pointer text-sm text-slate-700">Menü</summary><nav className="absolute right-0 top-8 z-50 grid min-w-44 gap-2 rounded-xl border bg-white p-3 shadow-lg">{([
        ["/dashboard", "Başlangıç", "context"], ["/dashboard/pos", "POS", "pos.sell"], ["/dashboard/orders", "Satışlar", "orders.read"], ["/dashboard/tables", "Masalar", "restaurant.read"], ["/dashboard/kitchen", "Mutfak", "kitchen.read"], ["/dashboard/products", "Ürünler", "products.manage"], ["/dashboard/categories", "Kategoriler", "products.manage"], ["/dashboard/stock", "Stok", "stock.manage"], ["/dashboard/recipes", "Reçeteler", "recipes.manage"], ["/dashboard/productions", "Üretim", "production.manage"], ["/dashboard/finance", "Kasa", "finance.manage"], ["/dashboard/accounts", "Cari Hesaplar", "finance.manage"], ["/dashboard/expenses", "Giderler", "finance.manage"], ["/dashboard/invoices", "Faturalar", "finance.manage"], ["/dashboard/customers", "Müşteriler", "customers.read"], ["/dashboard/suppliers", "Tedarikçiler", "suppliers.read"], ["/dashboard/reports", "Raporlar", "reports.read"], ["/dashboard/qr-menu", "QR Menü", "qr-menu.manage"], ["/dashboard/payments", "Ödemeler", "finance.manage"], ["/dashboard/staff", "Personel", "staff.read"], ["/dashboard/branches", "Şubeler", "context"],
      ] as [string, string, Permission][]).filter(([, , permission]) => hasPermission(role, permission)).map(([href, label]) => <Link className="text-sm text-slate-700" key={href} href={href}>{label}</Link>)}</nav></details>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Bildirimler"
          className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
        >
          <Bell size={19} />

          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
        </button>

        <div className="h-8 w-px bg-slate-200" />

        <ProfileMenu user={user} role={role} />
      </div>
    </header>
  );
}
