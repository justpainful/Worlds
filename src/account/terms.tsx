/**
 * Accepting the terms of use, the privacy policy and the content policy:
 * once at the start (the welcome has a step for it), when creating an
 * account, and again whenever the version changes. The account service keeps
 * the same version in services/identity/src/lib/terms.ts and sends the
 * current one in /config.
 */
import { useState } from "react";
import { uiLanguage } from "../i18n/ui";
import { openExternal } from "../lib/links";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { service, useService } from "./service";
import { useAccount } from "./store";

export const TERMS_VERSION = "2026-11-22";
export const TERMS_ACCEPTED = "terms.accepted";

function page(path: "terms" | "privacy" | "content-policy"): string {
  return `https://enterworlds.space/${uiLanguage() === "en" ? "en/" : ""}${path}/`;
}

/** The version people must accept now: the service's, or this build's when offline. */
export function currentTerms(): string {
  return useService.getState().config?.terms?.version ?? TERMS_VERSION;
}

export function termsAccepted(): boolean {
  return useStore.getState().settings[TERMS_ACCEPTED] === currentTerms();
}

export async function acceptTerms(): Promise<void> {
  const version = currentTerms();
  useStore.getState().setSetting(TERMS_ACCEPTED, version);
  // Signed in: the account remembers it too (best effort; the app asks again only when the version changes).
  if (useAccount.getState().view?.status === "active") await service("POST", "/me/terms", { version }).catch(() => undefined);
}

/** The three pages, as links, for the welcome, the sign-up form and the prompt. */
export function TermsLinks() {
  const link = (label: string, path: "terms" | "privacy" | "content-policy") => (
    <button type="button" className="terms-link" onClick={() => void openExternal(page(path))}>
      {label}
    </button>
  );
  return (
    <span className="terms-links">
      {link("Terms of use", "terms")}
      {link("Privacy policy", "privacy")}
      {link("Content policy", "content-policy")}
    </span>
  );
}

/** The checkbox: "I agree to the terms of use, the privacy policy and the content policy". */
export function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="terms-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>I have read and agree to the terms of use, the privacy policy and the content policy.</span>
    </label>
  );
}

/**
 * Covers the window until the current terms are accepted: after the welcome
 * was skipped, for people who used Worlds before 1.1, and when the terms change.
 */
export function TermsGate() {
  const onboarded = useStore((s) => !!s.settings["account.onboarded"]);
  const accepted = useStore((s) => s.settings[TERMS_ACCEPTED]) as string | undefined;
  const version = useService((s) => s.config?.terms?.version) ?? TERMS_VERSION;
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!onboarded || accepted === version) return null;
  const changed = !!accepted;
  return (
    <Modal onClose={() => undefined} width={460} bare className="acct-modal">
      <div className="acct-flow">
        <div className="acct-hero-icon">
          <Icon name="book" size={24} />
        </div>
        <h2 className="acct-title">{changed ? "We updated our terms" : "Before you continue"}</h2>
        <p className="acct-text">
          {changed
            ? "Please read what changed and accept the new terms to keep using Worlds. Your pages stay on this PC either way."
            : "Worlds asks everyone to accept its terms once. They are short and in plain words."}
        </p>
        <TermsLinks />
        <TermsCheck checked={agree} onChange={setAgree} />
        <div className="acct-actions">
          <Button
            variant="tinted"
            size="large"
            loading={busy}
            disabled={!agree}
            onClick={async () => {
              setBusy(true);
              await acceptTerms();
              setBusy(false);
            }}
          >
            Accept and Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
