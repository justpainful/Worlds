import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { PACKS_KEY } from "../packs/registry";
import { SYMBOLIC_AVAILABLE, symbolicUrl } from "../ui/symbolicMap";
import { drawnUrl } from "../ui/drawnMap";
import { HelloIntro } from "../onboarding/HelloIntro";
import { artUrl } from "../cognition/art";
import { SignInFlow } from "./SignIn";
import worldsLogo from "../assets/onboarding/worlds-logo.png";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import cognitionLogo from "../assets/onboarding/cognition-logo.png";

/** Worlds on the web keeps pages in the browser, and an account also keeps them on the person's account (src/web/vault.ts). */
const WEB = import.meta.env.VITE_WEB_DEMO === "1";

type Step = "intro" | "language" | "you" | "look" | "worlds" | "cognition" | "imbue" | "account" | "done";
const STEPS: Step[] = ["language", "you", "look", "worlds", "cognition", "imbue", "account", "done"];

/** What brings you here, and the packs that come with it. */
const ROLES: { id: string; label: string; text: string; icon: IconName; packs: string[] }[] = [
  { id: "student", label: "Studying", text: "Subjects, lessons, homework and exams", icon: "book", packs: ["study", "reading"] },
  { id: "teacher", label: "Teaching", text: "Classes, plans and marking", icon: "users", packs: ["teacher", "training"] },
  { id: "work", label: "Work", text: "Clients, projects and money", icon: "folder", packs: ["freelance", "consulting"] },
  { id: "creative", label: "Making things", text: "Writing, design, photos and content", icon: "palette", packs: ["writing", "design", "content"] },
  { id: "life", label: "Everyday life", text: "Money, health, family and trips", icon: "home", packs: ["money", "health", "family", "travel"] },
];

/**
 * First run: "Hello, Worlds!" and the three marks, then a few questions that
 * set Worlds up (language, what it is for, how it looks), a short look at
 * Worlds, Cognition and Imbue, and where the pages live.
 */
export function Onboarding({ withAccount = true, onClose }: { withAccount?: boolean; onClose?: () => void }) {
  const setSetting = useStore((s) => s.setSetting);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const [step, setStep] = useState<Step>("intro");
  const [roles, setRoles] = useState<string[]>([]);
  const steps = withAccount ? STEPS : STEPS.filter((s) => s !== "account");
  const finish = (tour = false) => {
    setSetting("account.onboarded", true);
    onClose?.();
    if (tour) setTimeout(() => window.dispatchEvent(new Event("worlds:tour")), 400);
  };
  const next = () => setStep(steps[Math.min(steps.length - 1, steps.indexOf(step) + 1)]);
  const back = () => setStep(steps[Math.max(0, steps.indexOf(step) - 1)]);

  if (step === "intro") return <HelloIntro onDone={() => setStep("language")} onSkip={() => setStep("language")} />;

  const index = steps.indexOf(step);
  const language = profile?.language ?? "en";
  const setLanguage = async (v: string) => setProfile(await api.updateProfile({ language: v }));
  const saveRoles = (list: string[]) => {
    setRoles(list);
    setSetting(PACKS_KEY, [...new Set(ROLES.filter((r) => list.includes(r.id)).flatMap((r) => r.packs))]);
  };

  return (
    <div className="ob">
      <div className="ob-card" key={step}>
        <div className="ob-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={s} className={i === index ? "is-on" : i < index ? "is-past" : ""} />
          ))}
        </div>

        {step === "language" && (
          <>
            <img className="ob-hero-logo" src={worldsLogo} alt="" height={96} />
            <h1 className="ob-title">{tr("Which language do you want?")}</h1>
            <p className="ob-text">{tr("You can change it any time in Settings.")}</p>
            <div className="ob-choices is-two">
              {[
                { v: "ar", label: "العربية", sub: "من اليمين إلى اليسار" },
                { v: "en", label: "English", sub: "Left to right" },
              ].map((o) => (
                <button key={o.v} className={`ob-choice ${language === o.v ? "is-on" : ""}`} onClick={() => setLanguage(o.v)} translate="no">
                  <b>{o.label}</b>
                  <span>{o.sub}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "you" && (
          <>
            <h1 className="ob-title">{tr("What brings you to Worlds?")}</h1>
            <p className="ob-text">{tr("Pick any that fit. Worlds turns on the packs that go with them, and you can change them later.")}</p>
            <div className="ob-choices">
              {ROLES.map((r) => {
                const on = roles.includes(r.id);
                return (
                  <button key={r.id} className={`ob-choice is-row ${on ? "is-on" : ""}`} onClick={() => saveRoles(on ? roles.filter((x) => x !== r.id) : [...roles, r.id])} aria-pressed={on}>
                    <Icon name={r.icon} size={22} />
                    <span className="ob-choice-text">
                      <b>{tr(r.label)}</b>
                      <span>{tr(r.text)}</span>
                    </span>
                    <span className="ob-check">{on && <Icon name="check" size={14} />}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "look" && (
          <>
            <h1 className="ob-title">{tr("How should Worlds look?")}</h1>
            <p className="ob-text">{tr("Three choices, each on its own. All of them are in Settings, under Appearance.")}</p>
            <div className="ob-rows">
              <div className="ob-row">
                <span>{tr("Theme")}</span>
                <Segmented
                  value={(settings["appearance.theme"] as string) ?? "dark"}
                  onChange={(v) => setSetting("appearance.theme", v)}
                  label={tr("Theme")}
                  options={[
                    { value: "dark", label: tr("Dark") },
                    { value: "light", label: tr("Light") },
                    { value: "system", label: tr("Automatic") },
                  ]}
                />
              </div>
              <div className="ob-row">
                <span>{tr("Design")}</span>
                <Segmented
                  value={(settings["appearance.design"] as string) === "drawn" ? "drawn" : "original"}
                  onChange={(v) => setSetting("appearance.design", v)}
                  label={tr("Design")}
                  options={[
                    { value: "original", label: tr("Original") },
                    { value: "drawn", label: tr("Hand-drawn") },
                  ]}
                />
              </div>
              <div className="ob-row is-icons">
                <span>{tr("Icons")}</span>
                <div className="ob-icon-sets">
                  {(SYMBOLIC_AVAILABLE ? ["lines", "symbolic", "gold", "teal", "pink", "blue"] : ["lines", "gold", "teal", "pink", "blue"]).map((v) => {
                    const on = ((settings["appearance.icons"] as string) ?? "lines") === v;
                    const name = v === "lines" ? "Original" : v === "symbolic" ? "Symbolic" : v[0].toUpperCase() + v.slice(1);
                    return (
                      <button key={v} className={`icon-set ${on ? "is-on" : ""}`} onClick={() => setSetting("appearance.icons", v)} aria-pressed={on} title={tr(name)}>
                        {v === "lines" ? (
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 10.5 12 3l9 7.5" />
                            <path d="M5 9.5V20h14V9.5" />
                            <path d="M10 20v-6h4v6" />
                          </svg>
                        ) : v === "symbolic" ? (
                          <span className="icon-symbol" style={{ width: 26, height: 26, WebkitMaskImage: `url("${symbolicUrl("home")}")`, maskImage: `url("${symbolicUrl("home")}")` }} />
                        ) : (
                          <img src={drawnUrl(v as "gold", "home") ?? ""} alt="" width={30} height={30} />
                        )}
                        <span>{tr(name)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {step === "worlds" && (
          <>
            <img className="ob-hero-logo" src={worldsLogo} alt="" height={110} />
            <h1 className="ob-title">{tr("Worlds: everything in one place")}</h1>
            <div className="ob-features">
              {(
                [
                  ["page", "Pages", "Blocks for text, tables, boards, forms, code and maps."],
                  ["checklist", "Plans", "Tasks, calendar, inbox and goals, with reminders."],
                  ["pen", "Drawing", "A full drawing space, and drawing over the screen."],
                  ["assistant", "Claude", "Writes and edits your pages, and every change can be undone."],
                ] as [IconName, string, string][]
              ).map(([icon, title, text]) => (
                <div key={title} className="ob-feature">
                  <Icon name={icon} size={22} />
                  <b>{tr(title)}</b>
                  <span>{tr(text)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === "cognition" && (
          <>
            <img className="ob-hero-logo" src={cognitionLogo} alt="" height={140} />
            <h1 className="ob-title">{tr("Cognition: for your own thinking")}</h1>
            <p className="ob-text">{tr("Not an assistant. Tools that help you understand and remember.")}</p>
            <div className="ob-features">
              {[
                ["mem_new", "Memory cards", "Brought back just before you would forget them."],
                ["ctx_question", "Open questions", "They stay open until you answer them."],
                ["discover", "Sparks", "Two ideas joined, with what you saw between them."],
                ["jigsaw", "Your world", "Your pages as islands, bridges and stars."],
              ].map(([art, title, text]) => (
                <div key={title} className="ob-feature">
                  <img src={artUrl(art) ?? ""} alt="" width={40} height={40} />
                  <b>{tr(title)}</b>
                  <span>{tr(text)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === "imbue" && (
          <>
            <img className="ob-imbue-logo" src={imbueLogo} alt="Imbue" height={96} />
            <h1 className="ob-title">Imbue</h1>
            <p className="ob-text">{tr("Imbue is coming in an update soon.")}</p>
          </>
        )}

        {step === "account" && <AccountStep onDone={next} />}

        {step === "done" && (
          <>
            <div className="ob-done-marks">
              <img src={worldsLogo} alt="" height={84} />
              <img src={imbueLogo} alt="" height={66} />
              <img src={cognitionLogo} alt="" height={112} />
            </div>
            <h1 className="ob-title">{tr("You're ready")}</h1>
            <p className="ob-text">{tr("Take the short tour of the window, or start right away.")}</p>
          </>
        )}

        {step !== "account" && (
          <div className="ob-foot">
            {index > 0 ? (
              <Button variant="quiet" onClick={back}>
                {tr("Back")}
              </Button>
            ) : (
              <span />
            )}
            {step === "done" ? (
              <div className="ob-foot-end">
                <Button onClick={() => finish(true)}>{tr("Take the Tour")}</Button>
                <Button variant="tinted" size="large" autoFocus onClick={() => finish(false)}>
                  {tr("Start")}
                </Button>
              </div>
            ) : (
              <Button variant="tinted" size="large" autoFocus onClick={next}>
                {tr("Continue")}
              </Button>
            )}
          </div>
        )}
      </div>
      {step !== "done" && (
        <button className="ob-skip" onClick={() => finish(false)}>
          {tr("Skip setup")}
        </button>
      )}
    </div>
  );
}

/** Where the pages live: on this device, or with an account as well. */
function AccountStep({ onDone }: { onDone: () => void }) {
  const [signing, setSigning] = useState(false);
  if (signing) return <SignInFlow onDone={onDone} onCancel={() => setSigning(false)} />;
  return (
    <>
      <h1 className="ob-title">{tr("Where should your pages live?")}</h1>
      <p className="ob-text">
        {tr(
          WEB
            ? "Your pages stay in this browser and work without a connection. Sign in to keep them on your account and open them anywhere."
            : "Your pages live on this PC and work without a connection. Add an account when you want to share a workspace with other people.",
        )}
      </p>
      <div className="ob-actions">
        <Button variant="tinted" size="large" autoFocus onClick={onDone}>
          {tr(WEB ? "Start in This Browser" : "Start on This PC")}
        </Button>
        <Button size="large" onClick={() => setSigning(true)}>
          {tr("Sign In or Create Account")}
        </Button>
      </div>
      <p className="ob-foot-note">{tr("You can add an account any time in Settings.")}</p>
    </>
  );
}
