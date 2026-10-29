"use client";
export default function MenuError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg px-5 py-20 text-center"><h1 className="text-2xl font-bold">Menü yüklenemedi</h1><p className="mt-4 text-slate-500">Lütfen biraz sonra tekrar deneyin veya işletme personeliyle görüşün.</p><button className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-white" onClick={reset}>Tekrar dene</button></main>;
}
