/** Settings-backed sync defaults for the app (tests use config.ts alone). */
import { useStore } from "../state/store";
import { colorFor, setDefaultSyncConfig, tokenSubject } from "./config";

const setting = (key: string): string | null => {
  const v = useStore.getState().settings[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

setDefaultSyncConfig({
  serverUrl: () => setting("sync.serverUrl"),
  getToken: async () => setting("sync.devToken"),
  user: () => {
    const s = useStore.getState();
    const id = tokenSubject(setting("sync.devToken")) ?? s.profile?.id ?? "me";
    return { id, name: s.profile?.displayName || "You", color: colorFor(id) };
  },
});
