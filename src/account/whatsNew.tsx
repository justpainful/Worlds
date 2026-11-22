/**
 * "What's new" once after an update: the release's title, summary and
 * highlights from its changelog file (web/changelog/releases/<version>.txt),
 * built into the app so it shows offline, with a link to the whole page.
 */
import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../appVersion";
import { uiLanguage } from "../i18n/ui";
import { openExternal } from "../lib/links";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { TERMS_ACCEPTED, currentTerms } from "./terms";

const LAST = "app.lastVersion";
const FILES = import.meta.glob("../../web/changelog/releases/*.txt", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

interface Notes {
  title: string;
  summary: string;
  highlights: { kind: string; text: string }[];
}

/** One language of a changelog file: "Arabic || English" on every line. */
export function parseRelease(raw: string, lang: "ar" | "en"): Notes {
  const side = (v: string) => {
    const [ar, en] = v.split(" || ");
    return (lang === "ar" ? ar : en ?? ar).trim();
  };
  const notes: Notes = { title: "", summary: "", highlights: [] };
  let inHighlights = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("# ")) {
      inHighlights = line.slice(2).trim() === "highlights";
      continue;
    }
    if (line.startsWith("title: ")) notes.title = side(line.slice(7));
    else if (line.startsWith("summary: ")) notes.summary = side(line.slice(9));
    else if (inHighlights && line.startsWith("- ")) {
      const m = /^- (new|improved|fixed): (.*)$/.exec(line);
      if (m) notes.highlights.push({ kind: m[1], text: side(m[2]) });
    }
  }
  return notes;
}

function newer(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

export function WhatsNew() {
  const onboarded = useStore((s) => !!s.settings["account.onboarded"]);
  const terms = useStore((s) => s.settings[TERMS_ACCEPTED]);
  const last = useStore((s) => s.settings[LAST]) as string | undefined;
  const setSetting = useStore((s) => s.setSetting);
  const [notes, setNotes] = useState<Notes | null>(null);
  // Onboarded before this start: someone who used an older Worlds, not a fresh install.
  const before = useRef(onboarded);

  useEffect(() => {
    if (!onboarded) return;
    // A fresh install starts here; only a later update shows what is new. Versions
    // before 1.1 did not keep the last version, so someone already set up just updated.
    if (!last && !before.current) {
      setSetting(LAST, APP_VERSION);
      return;
    }
    if (last && !newer(APP_VERSION, last)) return;
    const load = FILES[`../../web/changelog/releases/${APP_VERSION}.txt`];
    if (!load) {
      setSetting(LAST, APP_VERSION);
      return;
    }
    load().then((raw) => setNotes(parseRelease(raw, uiLanguage() === "ar" ? "ar" : "en")), () => setSetting(LAST, APP_VERSION));
  }, [onboarded, last, setSetting]);

  // The terms come first when both are waiting.
  if (!notes || terms !== currentTerms()) return null;
  const close = () => {
    setSetting(LAST, APP_VERSION);
    setNotes(null);
  };
  return (
    <Modal title={`Worlds ${APP_VERSION}`} onClose={close} width={500}>
      <div className="whats-new">
        <h2 className="whats-new-title bidi" translate="no">
          {notes.title}
        </h2>
        <p className="whats-new-summary bidi" translate="no">
          {notes.summary}
        </p>
        <ul className="whats-new-list">
          {notes.highlights.map((h, i) => (
            <li key={i} className="bidi" translate="no">
              {h.text}
            </li>
          ))}
        </ul>
      </div>
      <div className="whats-new-actions">
        <Button variant="plain" onClick={() => void openExternal(`https://changelog.enterworlds.space/${uiLanguage() === "en" ? "en/" : ""}${APP_VERSION}/`)}>
          Every Change
        </Button>
        <Button variant="tinted" onClick={close}>
          Continue
        </Button>
      </div>
    </Modal>
  );
}
