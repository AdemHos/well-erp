"use client";

import Image from "next/image";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import LogoutButton from "../landing/auth/LogoutButton";

type Props = {
  user: { name?: string | null; image?: string | null };
  role: string;
};

const roles: Record<string, string> = {
  OWNER: "İşletme Sahibi", ADMIN: "Yönetici", MANAGER: "Müdür",
  CASHIER: "Kasiyer", WAITER: "Garson", KITCHEN: "Mutfak", STAFF: "Personel",
};

export default function ProfileMenu({ user, role }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={container} className="relative shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" aria-label="Profil seçenekleri" aria-expanded={open}
        aria-controls={panelId} onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-full outline-none ring-offset-2 transition hover:ring-2 hover:ring-blue-200 focus-visible:ring-2 focus-visible:ring-blue-500">
        {user.image ? <Image src={user.image} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
          : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">{user.name?.charAt(0).toLocaleUpperCase("tr") || "U"}</span>}
      </button>

      {open && <nav id={panelId} aria-label="Profil işlemleri" className="absolute right-0 top-full z-50 mt-3 w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="truncate text-sm font-semibold text-slate-900">{user.name || "WellPOS Kullanıcısı"}</p>
          <p className="mt-1 text-xs text-slate-500">{roles[role] ?? role}</p>
        </div>
        <div className="p-1">
          <Link href="/profiles" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 outline-none hover:bg-slate-50 focus-visible:bg-slate-100">
            <UsersRound size={16} aria-hidden="true" />Hesap Değiştir
          </Link>
          <LogoutButton className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 outline-none transition hover:bg-red-50 focus-visible:bg-red-50" />
        </div>
      </nav>}
    </div>
  );
}
