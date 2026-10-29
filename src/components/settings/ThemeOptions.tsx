"use client";
import { useState } from "react";
import { Check, Monitor } from "lucide-react";
import { useDashboardTheme, type ThemePreference } from "@/lib/theme";
import { themePresets, getThemePreset } from "@/lib/theme-presets";
export default function ThemeOptions({ userId }: { userId: string }) {
  const { preference, preset, save } = useDashboardTheme(userId);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  function choose(value: ThemePreference) {
    setError(""); setMessage("");
    if (save(value)) setMessage("Tema tercihi kaydedildi.");
    else setError("Tarayıcı depolaması kullanılamıyor. Tema tercihi kaydedilemedi.");
  }
  return <section id="settings-theme" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Görünüm ve Tema">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">Görünüm ve Tema</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">Kullanıcıya özel · Bu tarayıcı</span></header>
    <p className="mt-3 text-sm text-slate-500">Hazır paletlerden çalışma ortamınıza uygun olanı seçin. Seçim anında uygulanır; Sistem seçeneği cihazınızın açık/koyu tercihini izler.</p>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Tema seçenekleri">{themePresets.map(option => <button key={option.id} type="button" aria-pressed={preference === option.id} onClick={() => choose(option.id)} className={`overflow-hidden rounded-xl border-2 text-left outline-none focus-visible:ring-4 focus-visible:ring-blue-300 ${preference === option.id ? "border-blue-500" : "border-slate-200"}`}>
      <div aria-hidden="true" className="flex h-24 gap-2 p-3" style={{ background: option.preview[0] }}><div className="w-7 rounded" style={{ background: option.preview[1] }}/><div className="flex flex-1 flex-col gap-2"><div className="h-2 w-16 rounded" style={{ background: option.preview[2], opacity: .8 }}/><div className="flex flex-1 gap-2">{[0, 1, 2].map(i => <div key={i} className="flex flex-1 items-end rounded p-1.5" style={{ background: option.preview[1], border: `1px solid ${option.preview[2]}40` }}><span className="h-1.5 w-2/3 rounded" style={{ background: option.preview[2] }}/></div>)}</div></div></div>
      <div className="bg-white p-3"><span className="flex items-center justify-between gap-2 font-semibold text-slate-900">{option.name}{preference === option.id && <Check size={17} className="text-blue-600"/>}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></div>
    </button>)}</div>
    <button type="button" aria-pressed={preference === "system"} onClick={() => choose("system")} className={`mt-3 flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm outline-none focus-visible:ring-4 focus-visible:ring-blue-300 ${preference === "system" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}><Monitor size={20}/><span className="flex-1">Sistem · Cihazın açık/koyu tercihini izle</span>{preference === "system" && <Check size={17}/>}</button>
    <p className="mt-3 text-xs text-slate-500">Etkin görünüm: {getThemePreset(preset).name}. Tercih bu kullanıcı için bu tarayıcıda saklanır; diğer cihazlara aktarılmaz. Fiş çıktıları beyaz kalır.</p>
    {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}
