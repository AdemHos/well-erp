import BrandLogo from "@/components/BrandLogo";
import { hasPermission, type Permission } from "@/lib/permissions";

import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingCart,
  Utensils,
  ClipboardList,
  ChefHat,
  Package,
  Tags,
  Boxes,
  BookOpen,
  Factory,
  Wallet,
  UsersRound,
  ReceiptText,
  FileText,
  CreditCard,
  Users,
  Truck,
  BarChart3,
  UserCog,
  Building2,
  QrCode,
  Plug,
  Settings,
} from "lucide-react";

const menuGroups = [
  {
    title: null,
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "SATIŞ",
    items: [
      {
        label: "POS / Yeni Satış",
        href: "/dashboard/pos",
        icon: ShoppingCart,
      },
      {
        label: "Masalar & Adisyonlar",
        href: "/dashboard/tables",
        icon: Utensils,
      },
      {
        label: "Siparişler",
        href: "/dashboard/orders",
        icon: ClipboardList,
      },
      {
        label: "Mutfak",
        href: "/dashboard/kitchen",
        icon: ChefHat,
      },
    ],
  },
  {
    title: "ÜRÜN & STOK",
    items: [
      {
        label: "Ürünler",
        href: "/dashboard/products",
        icon: Package,
      },
      {
        label: "Kategoriler",
        href: "/dashboard/categories",
        icon: Tags,
      },
      {
        label: "Stok",
        href: "/dashboard/stock",
        icon: Boxes,
      },
      {
        label: "Reçeteler",
        href: "/dashboard/recipes",
        icon: BookOpen,
      },
      {
        label: "Üretim",
        href: "/dashboard/productions",
        icon: Factory,
      },
    ],
  },
  {
    title: "FİNANS",
    items: [
      {
        label: "Kasa",
        href: "/dashboard/finance",
        icon: Wallet,
      },
      {
        label: "Cari Hesaplar",
        href: "/dashboard/accounts",
        icon: UsersRound,
      },
      {
        label: "Giderler",
        href: "/dashboard/expenses",
        icon: ReceiptText,
      },
      {
        label: "Faturalar",
        href: "/dashboard/invoices",
        icon: FileText,
      },
      {
        label: "Ödemeler",
        href: "/dashboard/payments",
        icon: CreditCard,
      },
    ],
  },
  {
    title: "YÖNETİM",
    items: [
      {
        label: "Müşteriler",
        href: "/dashboard/customers",
        icon: Users,
      },
      {
        label: "Tedarikçiler",
        href: "/dashboard/suppliers",
        icon: Truck,
      },
      {
        label: "Raporlar",
        href: "/dashboard/reports",
        icon: BarChart3,
      },
      {
        label: "Personel",
        href: "/dashboard/staff",
        icon: UserCog,
      },
      {
        label: "Şube Yönetimi",
        href: "/dashboard/branches",
        icon: Building2,
      },
      {
        label: "QR Menü",
        href: "/dashboard/qr-menu",
        icon: QrCode,
      },
      {
        label: "Entegrasyonlar",
        href: "/dashboard/integrations",
        icon: Plug,
      },
      {
        label: "Ayarlar",
        href: "/dashboard/settings",
        icon: Settings,
      },
    ],
  },
];

const routePermissions: Record<string, Permission> = {
  "/dashboard/settings": "settings.read",
  "/dashboard/integrations": "integrations.read",
  "/dashboard/qr-menu": "qr-menu.manage",
  "/dashboard": "context", "/dashboard/pos": "pos.sell", "/dashboard/orders": "orders.read",
  "/dashboard/tables": "restaurant.read", "/dashboard/kitchen": "kitchen.read", "/dashboard/products": "products.manage",
  "/dashboard/categories": "products.manage", "/dashboard/stock": "stock.manage", "/dashboard/recipes": "recipes.manage",
  "/dashboard/productions": "production.manage", "/dashboard/finance": "finance.manage", "/dashboard/accounts": "finance.manage", "/dashboard/expenses": "finance.manage", "/dashboard/invoices": "finance.manage", "/dashboard/payments": "finance.manage", "/dashboard/customers": "customers.read", "/dashboard/suppliers": "suppliers.read", "/dashboard/reports": "reports.read", "/dashboard/staff": "staff.read", "/dashboard/branches": "context",
};
const upcomingRoutes = new Set<string>([
]);

export default function Sidebar({ role }: { role: string }) {
  const visibleGroups = menuGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const permission = routePermissions[item.href];
      return permission ? hasPermission(role, permission)
        : upcomingRoutes.has(item.href) && hasPermission(role, "staff.manage");
    }),
  })).filter((group) => group.items.length);
  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 md:flex flex-col border-r border-slate-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-slate-200 px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandLogo className="h-14 w-24" variant="theme" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <div className="space-y-7">
          {visibleGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.title && (
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400">
                  {group.title}
                </p>
              )}

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  if (upcomingRoutes.has(item.href)) {
                    return (
                      <button key={item.href} type="button" disabled title="Bu modül henüz geliştirilmedi."
                        className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-400">
                        <Icon size={18} className="shrink-0" aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Yakında</span>
                      </button>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                    >
                      <Icon size={18} />

                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-200 p-4">
        <div className="rounded-xl bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-700">
            WellPOS
          </p>

          <p className="mt-1 text-xs leading-5 text-blue-600/70">
            İşletmenizi tek panelden yönetin.
          </p>
        </div>
      </div>
    </aside>
  );
}
