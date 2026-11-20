/**
 * Private pages: a page marked private opens only after a passcode or
 * Windows Hello, and stays out of search, the palette and Claude's context
 * until then. The mark lives in the page's look (`look.private`), the
 * passcode as a salted SHA-256 hash in settings. Unlocking lasts until
 * Worlds is locked again, the window is hidden for five minutes, or the
 * app restarts.
 */
import { useEffect, useState } from "react";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { promptText } from "../editor/prompt";

const HASH_KEY = "privacy.passcode";
const HELLO_KEY = "privacy.hello";

export const isPrivate = (p: PageMeta | undefined | null) => !!(p?.look as { private?: boolean } | undefined)?.private;

let unlocked = false;
let hiddenAt = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60000) lockPrivate();
});

export const privateUnlocked = () => unlocked;

/** Re-render when private pages are locked or unlocked. */
export function usePrivacy() {
  const [, bump] = useState(0);
  useEffect(() => onPrivacyChange(() => bump((n) => n + 1)), []);
  return unlocked;
}
export function lockPrivate() {
  unlocked = false;
  notify();
}
export function onPrivacyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Pages the palette, search and Claude may show right now. */
export const visibleNow = (p: PageMeta | undefined | null) => !isPrivate(p) || unlocked;

async function hash(code: string, salt: string) {
  const bytes = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const hasPasscode = () => typeof useStore.getState().settings[HASH_KEY] === "string";

/** Ask for a new passcode twice and keep its hash. */
export async function choosePasscode(): Promise<boolean> {
  const first = await promptText({ title: tr("Choose a passcode for private pages"), placeholder: tr("At least 4 characters"), confirm: tr("Next"), validate: (v) => (v.length < 4 ? tr("Use at least 4 characters") : null) });
  if (!first) return false;
  const again = await promptText({ title: tr("Type the passcode again"), confirm: tr("Save"), validate: (v) => (v !== first ? tr("The two passcodes are different") : null) });
  if (!again) return false;
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  useStore.getState().setSetting(HASH_KEY, `${salt}$${await hash(first, salt)}`);
  unlocked = true;
  notify();
  return true;
}

async function checkPasscode(code: string): Promise<boolean> {
  const stored = useStore.getState().settings[HASH_KEY];
  if (typeof stored !== "string" || !stored.includes("$")) return false;
  const [salt, want] = stored.split("$");
  return (await hash(code, salt)) === want;
}

const helloAvailable = () => typeof window.PublicKeyCredential !== "undefined" && !!navigator.credentials;

/** Register this device's Windows Hello (or Touch ID) for private pages. */
export async function enableHello(): Promise<boolean> {
  if (!helloAvailable()) return false;
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Worlds" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "worlds-private-pages", displayName: "Worlds" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    useStore.getState().setSetting(HELLO_KEY, btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
    return true;
  } catch {
    return false;
  }
}

async function unlockWithHello(): Promise<boolean> {
  const id = useStore.getState().settings[HELLO_KEY];
  if (typeof id !== "string" || !helloAvailable()) return false;
  try {
    const raw = Uint8Array.from(atob(id), (c) => c.charCodeAt(0));
    const got = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: raw }], userVerification: "required", timeout: 60000 },
    });
    return !!got;
  } catch {
    return false;
  }
}

/** Shown instead of a private page until it is unlocked. */
export function PrivateGate({ meta }: { meta: PageMeta }) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const hello = typeof useStore.getState().settings[HELLO_KEY] === "string";
  const unlock = async () => {
    if (await checkPasscode(code)) {
      unlocked = true;
      notify();
    } else {
      setBad(true);
      setCode("");
    }
  };
  void meta;
  return (
    <div className="private-gate">
      <div className="pg-card">
        <span className="pg-icon">
          <Icon name="lock" size={26} />
        </span>
        <h2>{tr("This page is private")}</h2>
        <p>{tr("Enter your passcode to open it.")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <input className={`field ${bad ? "is-bad" : ""}`} type="password" autoFocus value={code} onChange={(e) => (setCode(e.target.value), setBad(false))} placeholder={tr("Passcode")} aria-label={tr("Passcode")} />
          <button type="submit" className="btn btn-tinted btn-standard" disabled={!code}>
            {tr("Open")}
          </button>
        </form>
        {bad && <p className="pg-bad">{tr("That passcode is not right.")}</p>}
        {hello && (
          <button
            className="btn btn-plain btn-standard"
            onClick={async () => {
              if (await unlockWithHello()) {
                unlocked = true;
                notify();
              }
            }}
          >
            <Icon name="shield" size={15} />
            {tr("Use Windows Hello")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Mark a page private (setting a passcode first if there is none) or public again. */
export async function togglePrivate(meta: PageMeta, setLook: (patch: Record<string, unknown>) => Promise<void> | void) {
  if (isPrivate(meta)) return setLook({ private: false });
  if (!hasPasscode() && !(await choosePasscode())) return;
  unlocked = true;
  notify();
  await setLook({ private: true });
  useStore.getState().toast({ message: tr("Private. It opens with your passcode and stays out of search.") });
}
