import type { CSSProperties } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock3, Layers3, Wallet, UsersRound, ReceiptText, FileText, ArrowLeftRight } from "lucide-react";

export const financeInput = "finance-control w-full rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60";
export const financeButton = "finance-button inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed";
export const financeSecondary = "finance-secondary inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
export const financePanel = "finance-panel rounded-2xl p-4 md:p-6";

const sectionIcons = { finance: Wallet, accounts: UsersRound, expenses: ReceiptText, invoices: FileText, payments: ArrowLeftRight };
export function FinanceHeading({ section, title, description }: { section: keyof typeof sectionIcons; title: string; description: string }) {
  const Icon = sectionIcons[section];
  return <header className="flex items-start gap-3 sm:gap-4"><span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100/80 text-blue-600" aria-hidden="true"><Icon size={23} strokeWidth={1.8}/></span><div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight">{title}</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div></header>;
}

const tones = {
  blue: { bg: "#eff6ff", border: "#dbeafe", ink: "#1d4ed8", icon: Wallet },
  green: { bg: "#ecfdf5", border: "#d1fae5", ink: "#047857", icon: ArrowDownLeft },
  amber: { bg: "#fffbeb", border: "#fef3c7", ink: "#a16207", icon: Clock3 },
  rose: { bg: "#fff1f2", border: "#ffe4e6", ink: "#be123c", icon: ArrowUpRight },
  violet: { bg: "#f5f3ff", border: "#ede9fe", ink: "#6d28d9", icon: Layers3 },
};
export type FinanceTone = keyof typeof tones;
export function FinanceStat({ title, value, tone = "blue", description }: { title: string; value: string; tone?: FinanceTone; description?: string }) {
  const palette = tones[tone], Icon = palette.icon;
  const style = { "--stat-bg": palette.bg, "--stat-border": palette.border, "--stat-ink": palette.ink } as CSSProperties;
  return <div className="finance-stat min-w-0 rounded-2xl p-4 md:p-5" style={style}>
    <div className="relative z-10 flex items-start justify-between gap-3"><p className="pt-1 text-xs font-semibold leading-5 text-slate-600">{title}</p><span className="finance-stat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" aria-hidden="true"><Icon size={18} strokeWidth={1.8}/></span></div>
    <p className="finance-stat-value relative z-10 mt-3 break-words text-xl font-bold tracking-tight md:text-2xl">{value}</p>
    {description && <p className="relative z-10 mt-2 text-xs leading-5 text-slate-500">{description}</p>}
  </div>;
}
export function FinanceBadge({ children, tone = "blue" }: { children: React.ReactNode; tone?: FinanceTone | "neutral" }) {
  const color = tone === "neutral" ? { bg: "#f1f5f9", ink: "#64748b" } : tones[tone];
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: color.bg, color: color.ink }}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current"/>{children}</span>;
}
