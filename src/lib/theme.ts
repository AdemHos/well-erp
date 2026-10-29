"use client";
import { useSyncExternalStore } from "react";
import { parseTheme, resolvePreset, resolveTheme, type ThemePreference, type ThemePreset } from "@/lib/theme-presets";
export { parseTheme, resolveTheme } from "@/lib/theme-presets";
export type { ThemePreference } from "@/lib/theme-presets";
export const themeStorageKey = (userId: string) => `wellpos:theme:${userId}`;
const eventName = "wellpos:theme-changed";
function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", callback); window.addEventListener(eventName, callback); media.addEventListener("change", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); media.removeEventListener("change", callback); };
}
export function useDashboardTheme(userId: string) {
  const snapshot = useSyncExternalStore(subscribe, () => {
    let preference: ThemePreference = "light";
    try { preference = parseTheme(localStorage.getItem(themeStorageKey(userId))); } catch { /* Browser storage may be unavailable. */ }
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return `${preference}:${resolveTheme(preference, systemDark)}:${resolvePreset(preference, systemDark)}`;
  }, () => "light:light:light");
  const [preference, resolved, preset] = snapshot.split(":") as [ThemePreference, "light" | "dark", ThemePreset];
  function save(next: ThemePreference) {
    try { localStorage.setItem(themeStorageKey(userId), next); window.dispatchEvent(new Event(eventName)); return true; } catch { return false; }
  }
  return { preference, resolved, preset, save };
}
