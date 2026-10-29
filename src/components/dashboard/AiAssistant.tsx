"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";

const suggestions = ["Bugünkü işletme özetini çıkar.", "Bugünkü satışlar düne göre nasıl?", "Hangi ürünlerin stoğu kritik?"];

export default function AiAssistant({ provider = "openai" }: { provider?: "openai" | "gemini" }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ answer: string; generatedAt: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);

  async function ask(value: string) {
    if (pending.current || !value.trim()) return;
    pending.current = true; setLoading(true); setError(""); setResult(null); setQuestion(value);
    try {
      const response = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value }), signal: AbortSignal.timeout(45000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Yanıt alınamadı.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error && err.name !== "TimeoutError" ? err.message : "Yanıt süresi doldu. Yeniden deneyin.");
    } finally { pending.current = false; setLoading(false); }
  }

  return (
    <section className="mt-6 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm" aria-labelledby="ai-heading">
      <div className="flex items-center gap-2 text-indigo-700"><Sparkles size={21} aria-hidden="true" /><h2 id="ai-heading" className="text-lg font-semibold">İşletmene sor</h2><span className="rounded bg-indigo-50 px-2 py-0.5 text-xs">AI · Beta</span></div>
      <p className="mt-2 text-sm text-slate-600">Seçili şubenizin satışlarını ve kritik stoklarını yorumlayın. Her soru bağımsız yanıtlanır.</p>
      <div className="my-4 flex flex-wrap gap-2">{suggestions.map(text => <button key={text} type="button" disabled={loading} onClick={() => void ask(text)} className="rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 disabled:opacity-50">{text}</button>)}</div>
      <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ai-question" className="sr-only">İşletmeniz hakkında sorun</label>
        <input id="ai-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} required disabled={loading} placeholder="Örn. Bugünkü satışlarımı özetler misin?" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:outline-indigo-500" />
        <button disabled={loading || !question.trim()} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{loading ? "Hazırlanıyor…" : "Sor"}</button>
      </form>
      <div aria-live="polite" aria-busy={loading}>
        {loading && <p className="mt-4 text-sm text-slate-600">Şubenizin güncel verileri yorumlanıyor…</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {result && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{result.answer}</p><p className="mt-3 text-xs text-slate-500">Kaynak: seçili şubenin dashboard ve kritik stok verileri · {new Date(result.generatedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p></div>}
      </div>
      <p className="mt-3 text-xs text-slate-500">Sorunuz ve sınırlı şube özeti {provider === "gemini" ? "Google Gemini’ye" : "OpenAI’a"} gönderilir. {provider === "gemini" && "Gemini ücretsiz katmanında gönderilen içerik ürün geliştirmede kullanılabilir. "}AI yanıtları hata içerebilir; rakamları raporlardan doğrulayın.</p>
    </section>
  );
}
