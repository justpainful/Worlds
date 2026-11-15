/** Titles of linked items, read from the page map so a rename shows everywhere at once. */
import { useCallback } from "react";
import { pageTitle, useStore } from "../../state/store";

export function useTitleOf(): (id: string) => string {
  const pages = useStore((s) => s.pages);
  return useCallback((id: string) => {
    const p = pages[id];
    return p && !p.deletedAt ? pageTitle(p) : "";
  }, [pages]);
}
