/**
 * Someone who made their profile on Worlds on the web (app.enterworlds.space)
 * and then signs in on a computer should find the same profile here: the
 * picture, the banner and the details they set there. The web keeps its
 * workspace on the account (services/sync/src/vault.ts); after sign-in this
 * reads the profile from it once and fills in what this profile is missing.
 * The name and username already come from the account itself
 * (src-tauri/src/account/profile_link.rs). Nothing set here is replaced.
 */
import { invoke } from "@tauri-apps/api/core";
import { api } from "../lib/api";
import { useStore } from "../state/store";
import { missingFields, vaultBase, type Snapshot } from "./webProfileRules";

const DONE = "account.webProfileFor";

/** Bring the web profile's pictures and details to this computer, once per account. */
export async function adoptWebProfile(userId: string, accountServer: string | null): Promise<boolean> {
  const s = useStore.getState();
  if (s.settings[DONE] === userId) return false;
  const setting = s.settings["sync.serverUrl"];
  const base = vaultBase(typeof setting === "string" ? setting : null, accountServer);
  if (!base) return false;
  let token: string;
  try {
    token = (await invoke<{ token: string }>("sync_access_token", { force: false })).token;
  } catch {
    return false;
  }
  const get = (path: string) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  const res = await get("/v1/vault").catch(() => null);
  if (!res) return false; // offline: try again on the next sign-in or start
  if (res.status === 404) {
    s.setSetting(DONE, userId); // never used Worlds on the web
    return false;
  }
  if (!res.ok) return false;
  const snap = (await res.json().catch(() => null)) as Snapshot | null;
  const web = snap?.profile;
  const here = useStore.getState().profile as unknown as Record<string, unknown> | null;
  if (!web || !here) return false;

  const patch = missingFields(here, web);
  for (const key of ["avatar", "banner"] as const) {
    const id = web[key];
    if (!id || here[key]) continue;
    const file = await get(`/v1/vault/files/${encodeURIComponent(id)}`).catch(() => null);
    if (!file?.ok) continue;
    const name = snap?.fileInfo?.[id]?.name || `${key}.png`;
    const attachment = await api.importBytes(null, name, new Uint8Array(await file.arrayBuffer())).catch(() => null);
    if (attachment) patch[key] = attachment.id;
  }
  if (Object.keys(patch).length) {
    const profile = await api.updateProfile(patch).catch(() => null);
    if (profile) useStore.getState().setProfile(profile);
  }
  useStore.getState().setSetting(DONE, userId);
  return Object.keys(patch).length > 0;
}
