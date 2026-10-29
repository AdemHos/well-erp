import Link from "next/link";
import { Check, Play } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-[720px] overflow-hidden bg-slate-950">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center lg:bg-[center_45%]"
        style={{
          backgroundImage: "url('/images/hero.png')",
        }}
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Left dark gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />

      {/* Bottom gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-950/20" />

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[720px] max-w-7xl items-center px-6 pb-24 pt-28 lg:px-8">
        <div className="max-w-[620px]">
          <h1 className="text-5xl font-bold leading-[1.08] tracking-tight text-white md:text-6xl">
            Restoranınızın
            <br />
            Tüm Operasyonları
            <br />

            <span className="text-blue-500">
              Tek Platformda
            </span>
          </h1>

          <p className="mt-6 max-w-[560px] text-base leading-7 text-slate-300 md:text-lg">
            WellPOS, restoran, kafe ve benzeri işletmeler için geliştirilmiş
            bulut tabanlı, modüler ve yapay zekâ destekli yönetim sistemidir.
            Satıştan stok yönetimine, mutfaktan finansal raporlara kadar her
            şeyi tek yerden yönetin.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
            >
              Ücretsiz Dene
            </Link>

            <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-black/20 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10">
              <Play size={17} fill="white" />
              Tanıtım Videosu
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
            <Benefit text="Kredi kartı gerekmez" />
            <Benefit text="14 gün ücretsiz" />
            <Benefit text="Hızlı kurulum" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      <Check size={16} className="text-emerald-400" strokeWidth={3} />
      <span>{text}</span>
    </div>
  );
}