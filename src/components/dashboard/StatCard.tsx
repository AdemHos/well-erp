import { LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

type StatCardProps = {
  title: string;
  value: string;
  description?: string;
  change?: number;
  icon: LucideIcon;
  actionText?: string;
  actionHref?: string;
};

export default function StatCard({
  title,
  value,
  description,
  change,
  icon: Icon,
  actionText,
  actionHref,
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {title}
          </p>

          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
            {value}
          </p>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon size={21} />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex min-h-5 items-center">
        {change !== undefined ? (
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1 text-xs font-semibold ${
                isPositive ? "text-emerald-600" : "text-red-500"
              }`}
            >
              {isPositive ? (
                <TrendingUp size={14} />
              ) : (
                <TrendingDown size={14} />
              )}

              {Math.abs(change)}%
            </span>

            <span className="text-xs text-slate-400">
              düne göre
            </span>
          </div>
        ) : actionText && actionHref ? (
          <Link
            href={actionHref}
            className="text-xs font-semibold text-blue-600 transition hover:text-blue-500"
          >
            {actionText} →
          </Link>
        ) : (
          <span className="text-xs text-slate-400">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
