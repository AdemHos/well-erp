import {
  BrainCircuit,
  Cloud,
  Puzzle,
  ShieldCheck,
} from "lucide-react";

const benefits = [
  {
    icon: Cloud,
    title: "Bulut Tabanlı",
    description: "Her yerden erişim",
    style: "bg-blue-50 text-blue-600",
  },
  {
    icon: Puzzle,
    title: "Modüler Yapı",
    description: "İhtiyacın kadarını kullan",
    style: "bg-violet-50 text-violet-600",
  },
  {
    icon: BrainCircuit,
    title: "AI Destekli",
    description: "Veriye dayalı içgörüler",
    style: "bg-cyan-50 text-cyan-600",
  },
  {
    icon: ShieldCheck,
    title: "Rol Bazlı Yetki",
    description: "Kontrollü kullanıcı erişimi",
    style: "bg-emerald-50 text-emerald-600",
  },
];

export default function BenefitsBar() {
  return (
    <section className="relative z-20 mx-auto -mt-8 max-w-7xl px-6 lg:px-8">
      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map((benefit) => {
          const Icon = benefit.icon;

          return (
            <div
              key={benefit.title}
              className="flex items-center gap-4 border-b border-slate-100 p-6 last:border-none sm:border-r lg:border-b-0"
            >
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${benefit.style}`}
              >
                <Icon size={22} />
              </div>

              <div>
                <p className="font-bold text-slate-900">
                  {benefit.title}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {benefit.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}