import Link from "next/link";
export default function AccessDeniedPage() {
  return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-900">Erişim yetkiniz yok</h1><p className="mt-2 text-sm text-amber-800">Bu sayfa için gerekli izin veya aktif işletme üyeliği bulunmuyor. Şube/rol atamanız için işletme yöneticinize başvurun.</p><Link href="/dashboard" className="mt-4 inline-block text-sm underline">Başlangıç ekranına dön</Link></section>;
}
