"use client";
export function confirmSettingsNavigation() {
  return window.dispatchEvent(new Event("wellpos:settings-navigation", { cancelable: true }));
}
