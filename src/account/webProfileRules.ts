/** Pure rules for ./webProfile.ts, kept apart so they test without the app. */

export interface WebProfile {
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  status?: string | null;
  location?: string | null;
  accent?: string | null;
  links?: unknown[];
  bannerFocus?: string | null;
  avatarCrop?: string | null;
}

export interface Snapshot {
  profile?: WebProfile;
  fileInfo?: Record<string, { name?: string }>;
}

/**
 * The sync service's https address: the sync.serverUrl setting when it is set
 * (it may be a ws address), else the account service's sibling on the same
 * domain (login.enterworlds.space has its sync at connect.enterworlds.space).
 */
export function vaultBase(serverUrl: string | null | undefined, accountServer?: string | null): string | null {
  const url = (serverUrl ?? "").trim().replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
  if (/^https?:\/\//.test(url)) return url;
  const m = /^https:\/\/login\.([^/]+)\/?$/.exec((accountServer ?? "").trim());
  return m ? `https://connect.${m[1]}` : null;
}

/** What to copy: only what the profile here is missing. Exported for tests. */
export function missingFields(here: Record<string, unknown>, web: WebProfile): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  for (const key of ["bio", "status", "location", "accent", "links", "bannerFocus", "avatarCrop"] as const) {
    if (empty(here[key]) && !empty(web[key])) patch[key] = web[key];
  }
  return patch;
}

