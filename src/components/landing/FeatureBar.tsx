import {
  ClipboardList,
  CookingPot,
  Boxes,
  QrCode,
  ChartNoAxesCombined,
  Sparkles,
} from "lucide-react";

const features = [
  {
    title: "Adisyon & Masa",
    subtitle: "Yönetimi",
    icon: ClipboardList,
    className: "bg-blue-50 text-blue-600",
  },
  {
    title: "Mutfak",
    subtitle: "Ekranı",
    icon: CookingPot,
    className: "bg-violet-50 text-violet-600",
  },
  {
    title: "Stok & Reçete",
    subtitle: "Yönetimi",
    icon: Boxes,
    className: "bg-sky-50 text-sky-600",
  },
  {
    title: "QR Menü &",
    subtitle: "QR Sipariş",
    icon: QrCode,
    className: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Raporlar &",
    subtitle: "Finans",
    icon: ChartNoAxesCombined,
    className: "bg-fuchsia-50 text-fuchsia-600",
  },
  {
    title: "Yapay Zekâ",
    subtitle: "Asistanı",
    icon: Sparkles,
    className: "bg-purple-50 text-purple-600",
  },
];

export default function FeatureBar() {
  return (
    <section className="relative z-20 mx-auto -mt-16 max-w-7xl px-6 lg:px-8">
      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 sm:grid-cols-2 lg:grid-cols-6">
        {features.map((feature) => {
          const Icon = feature.icon;

          return (
            <div
              key={feature.title}
              className="flex items-center gap-3 border-b border-slate-100 p-5 last:border-none sm:border-r lg:border-b-0"
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${feature.className}`}
              >
                <Icon size={21} />
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {feature.title}
                </p>

                <p className="text-xs text-slate-500">
                  {feature.subtitle}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}