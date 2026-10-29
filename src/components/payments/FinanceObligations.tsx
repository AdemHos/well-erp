"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, money, Stat } from "@/components/current-accounts/shared";
type Overview = { payable: string; receivable: string; paid: string; collected: string };
export default function FinanceObligations() {
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ overview: Overview }>("/api/payments/overview", { signal: controller.signal }).then(r => { if (!controller.signal.aborted) setOverview(r.overview); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return <section className="space-y-3"><Link className="text-sm text-primary underline" href="/dashboard/payments">Ödemeler ve tahsilatları yönet →</Link>{overview && <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stat tone="rose" title="Aktif ödemeler" value={money(overview.paid)}/><Stat tone="green" title="Aktif tahsilatlar" value={money(overview.collected)}/><Stat tone="amber" title="Açık belge borcu" value={money(overview.payable)}/><Stat tone="blue" title="Açık satış faturası alacağı" value={money(overview.receivable)}/></div><p className="text-xs text-muted-foreground">Erişilebilir tüm şubeler · Açık belge borcu, kesin alış faturaları ve henüz kesin faturaya bağlı olmayan giderleri içerir. Bağlı gider/fatura bir kez sayılır. Cari açılış ve düzeltmeleri cari ekstrede izlenir.</p></>}</section>;
}
