/**
 * Sync defaults for the app (tests use config.ts alone).
 *
 * Signed in (src/account): the access token comes from the account through
 * `sync_access_token`, and the user is the account's user. Otherwise, for
 * testing without accounts, the settings `sync.devToken` and the profile.
 * The sync service address is the setting `sync.serverUrl` either way.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAccount } from "../account/store";
import { useStore } from "../state/store";
import { colorFor, configureSync, setDefaultSyncConfig, tokenSubject } from "./config";

const setting = (key: string): string | null => {
  const v = useStore.getState().settings[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const signedIn = () => {
  const v = useAccount.getState().view;
  return v?.status === "active" && v.account ? v.account : null;
};

setDefaultSyncConfig({
  serverUrl: () => setting("sync.serverUrl"),
  getToken: async (refresh) => {
    if (signedIn()) {
      try {
        return (await invoke<{ token: string }>("sync_access_token", { force: !!refresh })).token;
      } catch {
        /* signed out meanwhile, or offline: fall back below */
      }
    }
    return setting("sync.devToken");
  },
  user: () => {
    const a = signedIn();
    if (a) return { id: a.userId, name: a.displayName || a.email, color: colorFor(a.userId) };
    const s = useStore.getState();
    const id = tokenSubject(setting("sync.devToken")) ?? s.profile?.id ?? "me";
    return { id, name: s.profile?.displayName || "You", color: colorFor(id) };
  },
});

// Signing in or out changes who syncs: restart connections.
let who = signedIn()?.userId ?? null;
useAccount.subscribe(() => {
  const next = signedIn()?.userId ?? null;
  if (next === who) return;
  who = next;
  configureSync({});
});
