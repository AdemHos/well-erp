import {
  Building2,
  Coffee,
  Store,
  UtensilsCrossed,
} from "lucide-react";

const businesses = [
  {
    icon: Coffee,
    title: "Kafeler",
    description:
      "Hızlı satış, masa yönetimi, reçete ve stok süreçlerini tek sistemden yönetin.",
    features: ["Hızlı POS", "Masa yönetimi", "Reçete & stok"],
  },
  {
    icon: UtensilsCrossed,
    title: "Restoranlar",
    description:
      "Salon, mutfak, paket servis ve finans operasyonlarını merkezi hale getirin.",
    features: ["Adisyon", "Mutfak ekranı", "Paket servis"],
  },
  {
    icon: Store,
    title: "Hızlı Servis",
    description:
      "Yoğun sipariş trafiğini hızlı POS ve merkezi sipariş yönetimiyle yönetin.",
    features: ["Gel-Al", "QR sipariş", "Sipariş ekranı"],
  },
  {
    icon: Building2,
    title: "Çok Şubeli İşletmeler",
    description:
      "Şubelerin satış, stok ve operasyon verilerini merkezi olarak takip edin.",
    features: ["Şube yönetimi", "Merkezi rapor", "Yetkilendirme"],
  },
];

export default function UseCases() {
  return (
    <section
      id="sectors"
      className="bg-white pb-24 pt-28"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-600">
            Her İşletmeye Uyum Sağlar
          </p>

          <h2 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            WellPOS Kimler İçin?
          </h2>

          <p className="mt-4 leading-7 text-slate-500">
            Modüler yapı sayesinde işletmenizin çalışma biçimine uygun
            özellikleri bir araya getirin.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {businesses.map((business) => {
            const Icon = business.icon;

            return (
              <article
                key={business.title}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-slate-200/60"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon size={22} />
                </div>

                <h3 className="mt-5 text-lg font-bold text-slate-900">
                  {business.title}
                </h3>

                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {business.description}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {business.features.map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}