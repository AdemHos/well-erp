import {
  ArrowRight,
  Bike,
  Globe2,
  PlugZap,
  ShoppingBag,
  Store,
  Utensils,
} from "lucide-react";

const integrations = [
  {
    name: "Yemeksepeti",
    description: "Online sipariş",
    icon: Utensils,
    iconStyle: "bg-red-50 text-red-500",
  },
  {
    name: "Trendyol Yemek",
    description: "Online sipariş",
    icon: ShoppingBag,
    iconStyle: "bg-orange-50 text-orange-500",
  },
  {
    name: "GetirYemek",
    description: "Online sipariş",
    icon: Bike,
    iconStyle: "bg-violet-50 text-violet-600",
  },
  {
    name: "Migros Yemek",
    description: "Online sipariş",
    icon: Store,
    iconStyle: "bg-orange-50 text-orange-600",
  },
];

export default function Integrations() {
  return (
    <section
      id="integrations"
      className="relative overflow-hidden bg-white py-24"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-600">
            <PlugZap size={15} />
            ENTEGRASYONLAR
          </div>

          <h2 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            Tüm Kanallar
            <span className="text-blue-600"> Tek Ekranda</span>
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-500 md:text-base">
            Online sipariş kanallarınızı merkezi olarak yönetin.
            Siparişlerinizi farklı ekranlar arasında kaybolmadan tek
            noktadan takip edin.
          </p>
        </div>

        {/* Integration area */}
        <div className="relative mx-auto mt-16 max-w-5xl">
          {/* Decorative line */}
          <div className="absolute left-1/2 top-[88px] hidden h-px w-[72%] -translate-x-1/2 bg-gradient-to-r from-transparent via-blue-200 to-transparent lg:block" />

          <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {integrations.map((integration) => {
              const Icon = integration.icon;

              return (
                <article
                  key={integration.name}
                  className="group relative rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-slate-200/60"
                >
                  <div
                    className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${integration.iconStyle}`}
                  >
                    <Icon size={25} />
                  </div>

                  <h3 className="mt-4 text-sm font-semibold text-slate-900">
                    {integration.name}
                  </h3>

                  <p className="mt-1 text-xs text-slate-400">
                    {integration.description}
                  </p>

                  <div className="absolute left-1/2 top-full hidden h-5 w-px bg-blue-100 lg:block" />
                </article>
              );
            })}
          </div>

          {/* WellPOS Hub */}
          <div className="mx-auto mt-12 flex max-w-md items-center gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <Globe2 size={22} />
            </div>

            <div className="flex-1">
              <p className="font-semibold text-slate-900">
                WellPOS Entegrasyon Merkezi
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Siparişleriniz tek merkezde toplanır ve operasyon
                ekranlarınıza aktarılır.
              </p>
            </div>
          </div>

          <div className="mt-9 text-center">
            <button className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition hover:text-blue-500">
              Tüm entegrasyonları incele
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}