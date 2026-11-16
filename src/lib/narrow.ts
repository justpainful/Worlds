import { useSyncExternalStore } from "react";

/** A phone, or a window about as narrow as one. Matches the narrow block in shell.css. */
export const NARROW = "(max-width: 720px)";

/** A tablet held upright, or a half screen window: wide enough for the sidebar, not for seven day columns beside it. */
export const COMPACT = "(max-width: 1000px)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function isNarrow(): boolean {
  return matches(NARROW);
}

/** True while the media query matches; updates when the window is resized or turned. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matches(query),
    () => false,
  );
}

export function useNarrow(): boolean {
  return useMedia(NARROW);
}
