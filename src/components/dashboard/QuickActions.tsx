import Link from "next/link";
import {
  CircleDollarSign,
  PackagePlus,
  Plus,
  ShoppingCart,
} from "lucide-react";

const actions = [
  {
    title: "Yeni Satış",
    description: "POS ekranını aç",
    href: "/dashboard/pos",
    icon: ShoppingCart,
  },
  {
    title: "Ürün Ekle",
    description: "Yeni ürün oluştur",
    href: "/dashboard/products",
    icon: PackagePlus,
  },
  {
    title: "Gider Ekle",
    description: "Yeni gider kaydet",
    href: "/dashboard/expenses",
    icon: CircleDollarSign,
  },
];

export default function QuickActions() {
  return (
    <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-semibold text-slate-950">
          Hızlı İşlemler
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          Sık kullanılan işlemlere hızlı erişim.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <Link
              key={action.title}
              href={action.href}
              className="group flex items-center gap-4 rounded-xl border border-slate-100 p-4 transition hover:border-blue-100 hover:bg-blue-50/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                <Icon size={19} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">
                  {action.title}
                </p>

                <p className="mt-0.5 text-xs text-slate-400">
                  {action.description}
                </p>
              </div>

              <Plus
                size={17}
                className="text-slate-300 transition group-hover:text-blue-600"
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}