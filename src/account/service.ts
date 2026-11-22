/**
 * The account service's own features (docs/admin/PLAN.md, phase 9): its
 * settings for this app (maintenance, incidents, announcements, the oldest
 * version allowed, feature flags), suggestions and problem reports, messages
 * from the Worlds team, surveys, the testers programme, deleting the account,
 * a copy of one's data, and the daily usage counts a person agreed to send.
 *
 * Everything goes through the `service` action of the account command, which
 * only reaches these paths (src-tauri/src/account/commands.rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { APP_VERSION, appPlatform } from "../appVersion";
import { uiLanguage } from "../i18n/ui";
import { useStore } from "../state/store";
import { useAccount } from "./store";

export const SUPPORT_URL = "https://support.enterworlds.space";

export function service<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; saveTo?: string } = {}): Promise<T> {
  return invoke<T>("account", { action: "service", args: { method, path, body: body ?? null, auth: opts.auth, saveTo: opts.saveTo } });
}

type Text = { ar: string; en: string };
export interface Announcement {
  id: string;
  text: Text;
  level: "info" | "warning" | "critical" | string;
  link: string | null;
  dismissible: boolean;
}
export interface ServiceConfig {
  at: number;
  signups: string;
  maintenance: { on: boolean; readOnly: boolean; message?: Text };
  update: { required: false } | { required: true; minimum: string; dismissible: boolean; url: string };
  announcements: Announcement[];
  flags: Record<string, boolean>;
  publishing: { paused?: boolean; message?: Text } & Record<string, unknown>;
  incident: { on: boolean; title?: Text; body?: Text; startedAt?: number | null };
  /** The terms everyone must accept (terms.tsx). */
  terms?: { version: string; pages?: Record<string, string> };
  tester: boolean;
}

/** Text in the interface language, with the other one when it is empty. */
export function pick(t: Text | undefined): string {
  if (!t) return "";
  return (uiLanguage() === "ar" ? t.ar || t.en : t.en || t.ar) ?? "";
}

export const useService = create<{ config: ServiceConfig | null }>(() => ({ config: null }));

/** Is a feature switched on for this person (dashboard, Control, Feature flags)? Off until the service says otherwise. */
export function useFlag(key: string): boolean {
  return useService((s) => !!s.config?.flags[key]);
}

export async function refreshServiceConfig(): Promise<void> {
  const q = new URLSearchParams({ platform: appPlatform(), version: APP_VERSION, lang: uiLanguage() });
  try {
    const config = await service<ServiceConfig>("GET", `/config?${q}`);
    useService.setState({ config });
  } catch {
    // Offline or no account server: Worlds works the same without it.
  }
}

const DAY = 86_400_000;
const USAGE_KEY = "privacy.usageCounts";
const USAGE_SENT = "privacy.usageSentAt";
const USAGE_ASKED = "privacy.usageAsked";

/** The counts a person agreed to share: how much, never what. */
export function usageCounts(): Record<string, unknown> {
  const st = useStore.getState();
  const pages = Object.values(st.pages).filter((p) => !p.deletedAt);
  const kinds: Record<string, boolean> = {};
  for (const p of pages) if (p.kind && /^[a-z][a-zA-Z0-9]{0,30}$/.test(p.kind)) kinds[p.kind] = true;
  const settings = st.settings;
  return {
    platform: appPlatform(),
    version: APP_VERSION,
    pages: pages.length,
    features: {
      ...kinds,
      ai: typeof settings["ai.provider"] === "string",
      automations: !!settings["automations.enabled"],
      sync: useAccount.getState().view?.status === "active",
    },
    language: uiLanguage(),
    theme: typeof settings["appearance.theme"] === "string" ? settings["appearance.theme"] : undefined,
  };
}

async function sendUsage(force = false): Promise<void> {
  const st = useStore.getState();
  if (st.settings[USAGE_KEY] !== true) return;
  const last = Number(st.settings[USAGE_SENT] ?? 0);
  if (!force && Date.now() - last < DAY) return;
  try {
    await service("POST", "/me/usage", { data: usageCounts() });
    st.setSetting(USAGE_SENT, Date.now());
  } catch {
    // Tomorrow, then.
  }
}

export function setUsageCounts(on: boolean) {
  const st = useStore.getState();
  st.setSetting(USAGE_KEY, on);
  st.setSetting(USAGE_ASKED, true);
  if (on) void sendUsage(true);
}

export function usageAsked(): boolean {
  return !!useStore.getState().settings[USAGE_ASKED];
}

/**
 * Starts once the app is ready: reads the service's settings now, every five
 * minutes and when the window comes back, and sends the day's counts when the
 * person agreed to. Returns a stop function.
 */
export function startService(): () => void {
  const signedIn = () => useAccount.getState().view?.status === "active";
  const tick = () => {
    void refreshServiceConfig();
    if (signedIn()) void sendUsage();
  };
  tick();
  const timer = window.setInterval(tick, 5 * 60_000);
  const onFocus = () => {
    const at = useService.getState().config?.at ?? 0;
    if (Date.now() - at > 60_000) tick();
  };
  window.addEventListener("focus", onFocus);
  // Signing in or out changes the flags and what the person sees.
  let was = signedIn();
  const unsub = useAccount.subscribe((s) => {
    const now = s.view?.status === "active";
    if (now !== was) {
      was = now;
      tick();
    }
  });
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    unsub();
  };
}

// ---- the person's side of the service ---------------------------------------

export interface Deletion {
  dueAt: number | null;
  days: number;
  sharedWorkspaces: { id: string; name: string }[];
}
export interface TeamThread {
  id: string;
  subject: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  messages: { id: string; author: "team" | "person"; body: string; createdAt: number; read: boolean }[];
}
export interface Survey {
  id: string;
  question: Text;
  choices: Text[];
}

export const serviceApi = {
  deletion: () => service<Deletion>("GET", "/me/deletion"),
  scheduleDeletion: (challengeId: string, code: string) => service<{ dueAt: number }>("POST", "/me/deletion", { challengeId, code, lang: uiLanguage() }),
  cancelDeletion: () => service<{ ok: boolean }>("DELETE", "/me/deletion"),
  exportTo: (saveTo: string) => service<{ saved: boolean }>("GET", "/me/export", undefined, { saveTo }),
  exportData: () => service<unknown>("GET", "/me/export"),
  testers: () => service<{ status: "applied" | "accepted" | "declined" | null }>("GET", "/me/testers"),
  applyTesters: (platforms: string[]) => service<{ status: string }>("POST", "/me/testers", { platforms }),
  leaveTesters: () => service<{ ok: boolean }>("DELETE", "/me/testers"),
  surveys: () => service<Survey[]>("GET", "/me/surveys"),
  answerSurvey: (id: string, answer: { choice?: number; text?: string }) => service<{ ok: boolean }>("POST", `/me/surveys/${encodeURIComponent(id)}`, answer),
  messages: () => service<TeamThread[]>("GET", "/me/messages"),
  replyMessage: (id: string, body: string) => service<{ id: string }>("POST", `/me/messages/${encodeURIComponent(id)}`, { body }),
  suggest: (title: string, body: string) => service<{ id: string; number: number }>("POST", "/community/suggestions", { title, body, lang: uiLanguage() }),
  uploadPicture: (mime: string, data: string) => service<{ key: string }>("POST", "/support/files", { mime, data }),
  report: (r: { subject: string; body: string; files: string[]; fields: Record<string, string> }) =>
    service<{ number: number; ref: string }>("POST", "/support/requests", { kind: "problem", via: "app", lang: uiLanguage(), ...r }),
};
