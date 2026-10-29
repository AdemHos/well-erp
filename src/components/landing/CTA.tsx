import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export default function CTA() {
  return (
    <section className="bg-white px-6 py-20 lg:px-8">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-slate-950 px-8 py-14 md:px-14 lg:py-16">
        <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="absolute bottom-[-150px] left-1/3 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />

        <div className="relative flex flex-col justify-between gap-10 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-blue-400">
              <Sparkles size={16} />
              WellPOS Cloud
            </div>

            <h2 className="text-3xl font-bold text-white md:text-4xl">
              İşletmenizi Birlikte Büyütelim
            </h2>

            <p className="mt-4 max-w-xl leading-7 text-slate-400">
              Satış, stok, mutfak ve finans operasyonlarınızı tek
              platformda yönetmeye hazır olun.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Ücretsiz Dene
              <ArrowRight size={16} />
            </Link>

            <Link
              href="/contact"
              className="rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Bizimle Görüş
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}