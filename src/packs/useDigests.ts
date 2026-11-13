/** Runs the packs' daily summaries while Worlds is open: at start, then every half hour. */
import { useEffect } from "react";
import { createItem } from "../planning/actions";
import { useStore } from "../state/store";
import { DIGEST_DAY_KEY, runDigests } from "./digest";

const EVERY_MS = 30 * 60 * 1000;

export function useDigests(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = useStore.getState();
        await runDigests(
          s.pages,
          s.settings,
          (title) => createItem("inbox", { title }),
          (days) => useStore.getState().setSetting(DIGEST_DAY_KEY, days),
        );
      } finally {
        busy = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), EVERY_MS);
    return () => window.clearInterval(timer);
  }, [ready]);
}
