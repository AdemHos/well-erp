import {
  ArrowRight,
  Bike,
  Boxes,
  ChartNoAxesCombined,
  ChefHat,
  CookingPot,
  CreditCard,
  QrCode,
  ReceiptText,
  Smartphone,
  Store,
  Users,
} from "lucide-react";

const modules = [
  {
    title: "Adisyon ve Masa Yönetimi",
    description:
      "Bölme, birleştirme, konum değiştirme ve gelişmiş masa planı.",
    icon: Store,
    style: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Masaya Servis, Gel-Al, Paket",
    description:
      "Tüm sipariş kanallarını tek ekrandan yönetin.",
    icon: ReceiptText,
    style: "bg-orange-50 text-orange-600",
  },
  {
    title: "Mutfak Ekranı",
    description:
      "Siparişleri anlık olarak mutfağa iletin, hazırlık süresini takip edin.",
    icon: CookingPot,
    style: "bg-violet-50 text-violet-600",
  },
  {
    title: "Stok ve Reçete Yönetimi",
    description:
      "Akıllı reçete motoru ile otomatik stok düşümü ve maliyet takibi.",
    icon: Boxes,
    style: "bg-rose-50 text-rose-600",
  },
  {
    title: "Üretim Modülü",
    description:
      "Yarı mamul üretimi ve üretime bağlı stok hareketlerini yönetin.",
    icon: ChefHat,
    style: "bg-blue-50 text-blue-600",
  },
  {
    title: "QR Menü ve QR Sipariş",
    description:
      "Müşterileriniz menüyü telefonundan görüntüleyip sipariş verebilir.",
    icon: QrCode,
    style: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Mobil Uygulamalar",
    description:
      "Garson, patron ve kurye operasyonlarını mobil cihazlardan yönetin.",
    icon: Smartphone,
    style: "bg-cyan-50 text-cyan-600",
  },
  {
    title: "Kurye Takibi",
    description:
      "Kendi kurye ekibinizle sipariş ve teslimat süreçlerini takip edin.",
    icon: Bike,
    style: "bg-blue-50 text-blue-600",
  },
  {
    title: "Cari, Tedarikçi ve Gider",
    description:
      "Cari hesap, tedarikçi, gider ve ödeme süreçlerinizi takip edin.",
    icon: CreditCard,
    style: "bg-red-50 text-red-600",
  },
  {
    title: "Entegrasyonlar",
    description:
      "Online sipariş kanallarınızı merkezi olarak yönetin.",
    icon: ArrowRight,
    style: "bg-pink-50 text-pink-600",
  },
  {
    title: "Operasyonel ve Finansal Raporlar",
    description:
      "Satış, maliyet, kâr ve stok verilerinizi detaylı raporlayın.",
    icon: ChartNoAxesCombined,
    style: "bg-purple-50 text-purple-600",
  },
  {
    title: "Personel ve Yetkilendirme",
    description:
      "Personel rollerini ve sistem erişim yetkilerini kolayca yönetin.",
    icon: Users,
    style: "bg-indigo-50 text-indigo-600",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="bg-white py-24"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Header */}
        <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-blue-600">
              Modüler Altyapı
            </p>

            <h2 className="max-w-xl text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
              İşletmenizin Her İhtiyacı
              <br />
              Tek Çözümde
            </h2>
          </div>

          <div className="max-w-xl lg:pb-1">
            <p className="leading-7 text-slate-500">
              WellPOS, restoran ve kafe işletmelerinin günlük
              operasyonlarını kolaylaştırmak için ihtiyacınız olan
              modülleri tek bir bulut platformunda bir araya getirir.
            </p>
          </div>
        </div>

        {/* Modules */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((module) => {
            const Icon = module.icon;

            return (
              <article
                key={module.title}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-slate-200/50"
              >
                <div
                  className={`mb-5 flex h-11 w-11 items-center justify-center rounded-xl ${module.style}`}
                >
                  <Icon size={21} strokeWidth={2} />
                </div>

                <h3 className="mb-2 text-base font-semibold text-slate-900">
                  {module.title}
                </h3>

                <p className="text-sm leading-6 text-slate-500">
                  {module.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}