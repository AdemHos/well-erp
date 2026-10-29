"use client";
import type { CSSProperties, ReactNode } from "react";
import { useDashboardTheme } from "@/lib/theme";
import { getThemePreset } from "@/lib/theme-presets";
export default function DashboardTheme({ userId, children }: { userId: string; children: ReactNode }) {
  const { resolved, preset } = useDashboardTheme(userId);
  const colors = getThemePreset(preset).colors;
  const variables = Object.fromEntries(Object.entries(colors).map(([key, color]) => [`--dashboard-${key}`, color])) as CSSProperties;
  return <div data-dashboard-theme={resolved} data-dashboard-preset={preset} style={variables} className="min-h-screen bg-slate-50">{children}</div>;
}
