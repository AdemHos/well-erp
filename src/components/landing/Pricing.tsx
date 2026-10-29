import { Check } from "lucide-react";

const plans = [
  {
    name: "Başlangıç",
    description: "Küçük işletmeler için",
    price: "Yakında",
    features: [
      "POS ve satış yönetimi",
      "Ürün ve kategori yönetimi",
      "Temel stok yönetimi",
      "Temel raporlar",
    ],
  },
  {
    name: "Standart",
    description: "Büyüyen işletmeler için",
    price: "Yakında",
    popular: true,
    features: [
      "Başlangıç özellikleri",
      "Masa ve adisyon yönetimi",
      "Mutfak ekranı",
      "QR menü ve sipariş",
      "Reçete yönetimi",
    ],
  },
  {
    name: "Profesyonel",
    description: "Kapsamlı yönetim için",
    price: "Yakında",
    features: [
      "Standart özellikleri",
      "Finans ve cari hesaplar",
      "Gelişmiş raporlar",
      "WellAI özellikleri",
      "Şube yönetimi",
    ],
  },
  {
    name: "Kurumsal",
    description: "Zincir işletmeler için",
    price: "Özel Teklif",
    features: [
      "Tüm modüller",
      "Çoklu şube yönetimi",
      "Gelişmiş yetkilendirme",
      "Özel entegrasyonlar",
      "Öncelikli destek",
    ],
  },
];

export default function Pricing() {
  return (
    <section
      id="pricing"
      className="bg-slate-50 py-24"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-600">
            Esnek Paketler
          </p>

          <h2 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            İşletmenizle Birlikte Büyüyen Yapı
          </h2>

          <p className="mt-4 text-slate-500">
            İhtiyacınız olan modülleri seçin, işletmeniz büyüdükçe
            sisteminizi genişletin.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`relative flex flex-col rounded-2xl bg-white p-7 ${
                plan.popular
                  ? "border-2 border-blue-600 shadow-xl shadow-blue-100"
                  : "border border-slate-200"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold text-white">
                  En Popüler
                </span>
              )}

              <h3 className="text-lg font-bold text-slate-900">
                {plan.name}
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                {plan.description}
              </p>

              <div className="mt-7">
                <span className="text-3xl font-bold text-slate-950">
                  {plan.price}
                </span>
              </div>

              <div className="my-7 h-px bg-slate-100" />

              <div className="flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <div
                    key={feature}
                    className="flex gap-2.5 text-sm text-slate-600"
                  >
                    <Check
                      size={17}
                      className="shrink-0 text-emerald-500"
                    />
                    {feature}
                  </div>
                ))}
              </div>

              <button
                className={`mt-8 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                  plan.popular
                    ? "bg-blue-600 text-white hover:bg-blue-500"
                    : "border border-slate-200 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                }`}
              >
                {plan.name === "Kurumsal"
                  ? "Bizimle İletişime Geç"
                  : "Detayları Gör"}
              </button>
            </article>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Paket içerikleri ve fiyatlandırma ürünün ticari lansmanı
          öncesinde güncellenecektir.
        </p>
      </div>
    </section>
  );
}