"use client";

import BrandLogo from "@/components/BrandLogo";

import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="absolute left-0 top-0 z-50 w-full">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
        
        <Link href="/" className="flex items-center gap-2">
<BrandLogo className="h-16 w-24 rounded-lg bg-white px-1" />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          <Link
            href="#features"
            className="text-sm font-medium text-white/80 transition hover:text-white"
          >
            Özellikler
          </Link>

          <Link
            href="#modules"
            className="text-sm font-medium text-white/80 transition hover:text-white"
          >
            Modüller
          </Link>

          <Link
            href="#pricing"
            className="text-sm font-medium text-white/80 transition hover:text-white"
          >
            Fiyatlandırma
          </Link>

          <Link
            href="#sectors"
            className="text-sm font-medium text-white/80 transition hover:text-white"
          >
            Sektörler
          </Link>

          <button className="flex items-center gap-1 text-sm font-medium text-white/80 transition hover:text-white">
            Kaynaklar
            <ChevronDown size={15} />
          </button>
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-white transition hover:text-blue-200"
          >
            Giriş Yap
          </Link>

          <Link
            href="/register"
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          >
            Ücretsiz Dene
          </Link>
        </div>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="text-white lg:hidden"
          aria-label="Menüyü aç"
        >
          <Menu size={26} />
        </button>
      </div>

      {menuOpen && (
        <div className="mx-4 rounded-2xl border border-white/10 bg-slate-950/95 p-5 backdrop-blur-xl lg:hidden">
          <nav className="flex flex-col gap-4">
            <Link href="#features">Özellikler</Link>
            <Link href="#modules">Modüller</Link>
            <Link href="#pricing">Fiyatlandırma</Link>
            <Link href="#sectors">Sektörler</Link>

            <div className="my-1 h-px bg-white/10" />

            <Link href="/login">Giriş Yap</Link>

            <Link
              href="/register"
              className="rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white"
            >
              Ücretsiz Dene
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}