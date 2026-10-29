import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <Link
            href="/"
            className="text-xl font-bold text-slate-950"
          >
            <BrandLogo className="h-20 w-30" />
          </Link>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-500">
            <Link href="#features" className="hover:text-slate-900">
              Özellikler
            </Link>

            <Link href="#pricing" className="hover:text-slate-900">
              Fiyatlandırma
            </Link>

            <Link href="#integrations" className="hover:text-slate-900">
              Entegrasyonlar
            </Link>

            <Link href="/privacy" className="hover:text-slate-900">
              Gizlilik
            </Link>

            <Link href="/contact" className="hover:text-slate-900">
              İletişim
            </Link>
          </div>

          <p className="text-sm text-slate-400">
            © 2026 WellPOS
          </p>
        </div>
      </div>
    </footer>
  );
}