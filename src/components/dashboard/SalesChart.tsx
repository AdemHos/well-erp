"use client";
import { useState } from "react";
import type { SalesPoint } from "@/lib/dashboard-data";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function SalesChart({ charts }: { charts: Record<"today" | "week" | "month", SalesPoint[]> }) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const salesData = charts[period];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-slate-950">
            Satış Performansı
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            {period === "today" ? "Bugünkü saatlik net satış" : period === "week" ? "Son 7 günlük net satış" : "Son 30 günlük net satış"} · İstanbul saati
          </p>
        </div>

        <select
          aria-label="Satış grafiği dönemi"
          value={period}
          onChange={event => setPeriod(event.target.value as typeof period)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 outline-none"
        >
          <option value="today">Bugün</option>
          <option value="week">Son 7 gün</option>
          <option value="month">Son 30 gün</option>
        </select>
      </div>

      {salesData.every(point => point.sales === 0) && <p className="mt-3 text-sm text-slate-500">Bu dönemde tamamlanmış satış bulunmuyor.</p>}
      <div className="mt-6 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={salesData}>
            <defs>
              <linearGradient
                id="salesGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="#2563eb"
                  stopOpacity={0.25}
                />
                <stop
                  offset="95%"
                  stopColor="#2563eb"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#e2e8f0"
            />

            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#94a3b8" }}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#94a3b8" }}
              tickFormatter={(value) => `₺${value}`}
            />

            <Tooltip
              formatter={(value) => [
                formatCurrency(Number(value)),
                "Satış",
              ]}
            />

            <Area
              type="monotone"
              dataKey="sales"
              stroke="#2563eb"
              strokeWidth={2}
              fill="url(#salesGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
