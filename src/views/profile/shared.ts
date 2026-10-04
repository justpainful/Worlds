import { useEffect, useState } from "react";
import { useStore } from "../../state/store";

export type Link = { label: string; url: string };
export type Tab = "pages" | "media" | "about";

export const SESSION_START = Date.now();
export const toast = (message: string, tone: "error" | "success" | "info" = "info") => useStore.getState().toast({ message, tone });

export function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : n.toLocaleString());
