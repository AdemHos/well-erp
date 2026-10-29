"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return <div role="alert" className="rounded-xl border border-rose-200 p-6"><h2 className="text-lg font-semibold">Veriler yüklenemedi</h2><p className="my-3">Bağlantınızı kontrol edip tekrar deneyin.</p><button onClick={reset} className="rounded-lg bg-blue-600 px-4 py-2 text-white">Tekrar dene</button></div>;
}
