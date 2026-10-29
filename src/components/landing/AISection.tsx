import {
  ArrowRight,
  BarChart3,
  Check,
  Send,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

const benefits = [
  "Günlük satış özetleri ve öngörüler",
  "Stok tahmini ve düşük stok uyarıları",
  "Maliyet ve kâr marjı analizleri",
  "Kişiselleştirilmiş öneriler ve rapor özetleri",
];

const products = [
  {
    name: "Cheeseburger",
    sales: "520",
    revenue: "₺78.000",
    margin: "%72,4",
  },
  {
    name: "Tavuk Burger",
    sales: "480",
    revenue: "₺62.400",
    margin: "%66,1",
  },
  {
    name: "Americano",
    sales: "1.240",
    revenue: "₺80.600",
    margin: "%65,7",
  },
  {
    name: "Latte",
    sales: "980",
    revenue: "₺73.500",
    margin: "%62,3",
  },
];

export default function AISection() {
  return (
    <section
      id="ai"
      className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/60 to-violet-50 py-24"
    >
      {/* Decorative backgrounds */}
      <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-blue-200/30 blur-3xl" />
      <div className="absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        {/* LEFT */}
        <div>
          <div className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">
            <Sparkles size={17} />
            YAPAY ZEKÂ DESTEKLİ
          </div>

          <h2 className="text-4xl font-bold tracking-tight text-slate-950 md:text-5xl">
            İşletmenizin
            <br />
            <span className="text-blue-600">Akıllı Asistanı</span>
          </h2>

          <p className="mt-6 max-w-lg text-base leading-7 text-slate-600">
            WellAI, işletme verilerinizi analiz ederek operasyonlarınızı
            daha iyi anlamanıza yardımcı olur ve karar süreçlerinizi
            destekleyen içgörüler sunar.
          </p>

          <div className="mt-8 space-y-4">
            {benefits.map((benefit) => (
              <div
                key={benefit}
                className="flex items-center gap-3 text-sm font-medium text-slate-700"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <Check
                    size={14}
                    className="text-emerald-600"
                    strokeWidth={3}
                  />
                </div>

                {benefit}
              </div>
            ))}
          </div>

          <button className="mt-9 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500">
            AI Özelliklerini Keşfet
            <ArrowRight size={17} />
          </button>
        </div>

        {/* AI PANEL */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-3 shadow-2xl shadow-blue-900/10">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                  <Sparkles
                    size={20}
                    className="text-violet-600"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      WellAI
                    </p>

                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
                      BETA
                    </span>
                  </div>

                  <p className="text-xs text-slate-400">
                    Yapay Zekâ Asistanınız
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Çevrimiçi
              </div>
            </div>

            {/* Chat */}
            <div className="space-y-5 bg-slate-50/50 p-5 sm:p-6">
              {/* User */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm text-white">
                  Bu ay en çok satan ürünleri ve kâr marjlarını
                  gösterebilir misin?
                </div>
              </div>

              {/* AI response */}
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100">
                  <Sparkles
                    size={15}
                    className="text-violet-600"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white p-4">
                    <p className="mb-4 text-sm leading-6 text-slate-600">
                      Tabii. Bu ay en çok satan ürünleriniz ve
                      tahmini kâr marjları:
                    </p>

                    {/* Desktop table */}
                    <div className="hidden overflow-hidden rounded-xl border border-slate-200 sm:block">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2.5 font-medium">
                              Ürün
                            </th>
                            <th className="px-3 py-2.5 font-medium">
                              Satış
                            </th>
                            <th className="px-3 py-2.5 font-medium">
                              Toplam
                            </th>
                            <th className="px-3 py-2.5 font-medium">
                              Kâr Marjı
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {products.map((product) => (
                            <tr
                              key={product.name}
                              className="border-t border-slate-100"
                            >
                              <td className="px-3 py-2.5 font-medium text-slate-700">
                                {product.name}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500">
                                {product.sales}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500">
                                {product.revenue}
                              </td>
                              <td className="px-3 py-2.5 font-medium text-emerald-600">
                                {product.margin}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile simplified */}
                    <div className="space-y-2 sm:hidden">
                      {products.map((product) => (
                        <div
                          key={product.name}
                          className="flex items-center justify-between rounded-lg bg-slate-50 p-3"
                        >
                          <div>
                            <p className="text-xs font-semibold text-slate-700">
                              {product.name}
                            </p>

                            <p className="mt-1 text-[11px] text-slate-400">
                              {product.sales} satış
                            </p>
                          </div>

                          <span className="text-xs font-semibold text-emerald-600">
                            {product.margin}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-xl bg-emerald-50 p-3">
                      <div className="flex gap-2">
                        <TrendingUp
                          size={16}
                          className="mt-0.5 shrink-0 text-emerald-600"
                        />

                        <p className="text-xs leading-5 text-emerald-800">
                          Cheeseburger satışları geçen aya göre yükseldi
                          ve yüksek kâr marjını koruyor.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Suggestions */}
              <div className="flex flex-wrap gap-2 pl-0 sm:pl-11">
                <Suggestion>
                  <BarChart3 size={13} />
                  Satış analizi
                </Suggestion>

                <Suggestion>
                  <TriangleAlert size={13} />
                  Stok tahmini
                </Suggestion>

                <Suggestion>
                  <TrendingUp size={13} />
                  Kâr marjı analizi
                </Suggestion>
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-slate-100 bg-white p-4">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
                <input
                  type="text"
                  placeholder="WellAI'a bir şey sor..."
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  readOnly
                />

                <button
                  type="button"
                  aria-label="Gönder"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}

function Suggestion({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <button className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600 transition hover:bg-blue-100">
      {children}
    </button>
  );
}