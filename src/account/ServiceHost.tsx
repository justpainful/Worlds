/**
 * What the account service shows in the app (docs/admin/PLAN.md, phase 9):
 * notices at the top of the window (an incident, maintenance, announcements,
 * an update to install), a survey or the usage question once in a while, and
 * the sheets for feedback, messages from the Worlds team and deleting the
 * account.
 */
import { useEffect, useRef, useState } from "react";
import "./account.css";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/profiles";
import { errorMessage } from "../lib/api";
import { openExternal } from "../lib/links";
import { useStore } from "../state/store";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import { relTime } from "../ui/misc";
import { APP_VERSION, appPlatform } from "../appVersion";
import { uiLanguage } from "../i18n/ui";
import { accountApi } from "./api";
import { useAccount } from "./store";
import { pick, serviceApi, setUsageCounts, startService, SUPPORT_URL, usageAsked, useService, type ServiceConfig, type Survey, type TeamThread } from "./service";

type Sheet = { kind: "feedback"; mode?: "idea" | "problem" } | { kind: "messages" } | { kind: "delete" } | null;
export const useServiceUi = create<{ sheet: Sheet; open: (s: Sheet) => void }>((set) => ({ sheet: null, open: (sheet) => set({ sheet }) }));
export const openFeedback = (mode: "idea" | "problem" = "idea") => useServiceUi.getState().open({ kind: "feedback", mode });

const DISMISSED = "service.dismissed";
// The browser preview (?mock) asks sooner, so the card can be looked at.
const PROMPT_DELAY = typeof location !== "undefined" && new URLSearchParams(location.search).has("mock") ? 3_000 : 60_000;

export function ServiceHost() {
  useEffect(() => startService(), []);
  const sheet = useServiceUi((s) => s.sheet);
  const close = () => useServiceUi.getState().open(null);
  return (
    <>
      <ServiceNotices />
      <Prompts />
      {sheet?.kind === "feedback" && <FeedbackSheet initial={sheet.mode ?? "idea"} onClose={close} />}
      {sheet?.kind === "messages" && <MessagesSheet onClose={close} />}
      {sheet?.kind === "delete" && <DeleteSheet onClose={close} />}
    </>
  );
}

// ---- notices -----------------------------------------------------------------

interface Note {
  id: string;
  tone: "info" | "warning";
  text: string;
  link?: { label: string; url: string };
  dismissible: boolean;
}

function notesOf(config: ServiceConfig, dismissed: string[] | undefined): Note[] {
  const notes: Note[] = [];
  if (config.incident.on) {
    const title = pick(config.incident.title);
    const body = pick(config.incident.body);
    notes.push({ id: "incident", tone: "warning", text: [title, body].filter(Boolean).join(". "), link: { label: "Status", url: "https://status.enterworlds.space" }, dismissible: false });
  }
  if (config.maintenance.on) {
    notes.push({
      id: "maintenance",
      tone: "warning",
      text: pick(config.maintenance.message) || (config.maintenance.readOnly ? "Worlds is under maintenance. Sharing and syncing are read only for now." : "Worlds is under maintenance."),
      dismissible: false,
    });
  }
  for (const a of config.announcements) {
    if (a.dismissible && dismissed?.includes(a.id)) continue;
    notes.push({ id: a.id, tone: a.level === "info" ? "info" : "warning", text: pick(a.text), link: a.link ? { label: "Learn More", url: a.link } : undefined, dismissible: a.dismissible });
  }
  const update = config.update;
  if (update.required && update.dismissible && !dismissed?.includes(`update:${update.minimum}`)) {
    notes.push({ id: `update:${update.minimum}`, tone: "info", text: `Worlds ${update.minimum} is ready. Update to keep everything working.`, link: { label: "Download", url: update.url }, dismissible: true });
  }
  return notes.slice(0, 3);
}

function ServiceNotices() {
  const config = useService((s) => s.config);
  const dismissed = useStore((s) => s.settings[DISMISSED]) as string[] | undefined;
  const setSetting = useStore((s) => s.setSetting);
  // The welcome comes first; notices wait until it is done.
  const onboarded = useStore((s) => !!s.settings["account.onboarded"]);
  // A required update that cannot wait covers the window.
  const [later, setLater] = useState(false);
  const notes = config && onboarded ? notesOf(config, dismissed) : [];
  const box = useRef<HTMLDivElement>(null);
  // Notices sit at the bottom of the window; toasts rise above them.
  useEffect(() => {
    const root = document.documentElement;
    const el = box.current;
    if (!el) {
      root.style.removeProperty("--svc-notes-h");
      return;
    }
    const ro = new ResizeObserver(() => root.style.setProperty("--svc-notes-h", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--svc-notes-h");
    };
  }, [notes.length]);
  if (!config) return null;
  const update = config.update;

  return (
    <>
      {notes.length > 0 &&
        createPortal(
          <div ref={box} className="svc-notes" role="region" aria-label="Notices from Worlds">
            {notes.map((n) => (
              <Glass key={n.id} material="menu" layer={LAYER.floating} className={`svc-note is-${n.tone}`} radius="var(--r-capsule)">
                <div className="svc-note-row">
                  <Icon name={n.tone === "warning" ? "warning" : "announce"} size={16} />
                  <span className="svc-note-text bidi" translate={n.id.startsWith("update:") ? undefined : "no"}>
                    {n.text}
                  </span>
                  {n.link && (
                    <button type="button" className="toast-action" onClick={() => void openExternal(n.link!.url)}>
                      {n.link.label}
                    </button>
                  )}
                  {n.dismissible && <IconButton icon="close" label="Dismiss" onClick={() => setSetting(DISMISSED, [...(dismissed ?? []), n.id].slice(-50))} />}
                </div>
              </Glass>
            ))}
          </div>,
          document.body,
        )}
      {update.required && !update.dismissible && !later && (
        <Modal title="Update Worlds" onClose={() => setLater(true)} width={420}>
          <div className="acct-flow">
            <div className="acct-hero-icon">
              <Icon name="download" size={24} />
            </div>
            <p className="acct-text">
              This version of Worlds ({APP_VERSION}) is too old for the account service. Install {update.minimum} or later to keep syncing and sharing. Your pages on this PC are safe.
            </p>
            <div className="acct-actions">
              <Button variant="tinted" size="large" icon="download" onClick={() => void openExternal(update.url)}>
                Download Worlds
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- a survey, or the usage question, once in a while -------------------------

function Prompts() {
  const signedIn = useAccount((s) => s.view?.status === "active");
  const ready = useService((s) => !!s.config);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [askUsage, setAskUsage] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn || !ready) return;
    let gone = false;
    // A minute after start, never in the way of what the person opened Worlds for.
    const t = window.setTimeout(async () => {
      const skipped = (useStore.getState().settings["service.surveysSkipped"] as string[] | undefined) ?? [];
      const list = await serviceApi.surveys().catch(() => [] as Survey[]);
      const next = list.find((s) => !skipped.includes(s.id));
      if (gone) return;
      if (next) setSurvey(next);
      else if (!usageAsked()) setAskUsage(true);
    }, PROMPT_DELAY);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [signedIn, ready]);

  const answer = async (a: { choice?: number; text?: string }) => {
    if (!survey) return;
    setBusy(true);
    try {
      await serviceApi.answerSurvey(survey.id, a);
      useStore.getState().toast({ message: "Thank you", tone: "success" });
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
    setBusy(false);
    setSurvey(null);
  };
  const skip = () => {
    if (!survey) return;
    const st = useStore.getState();
    st.setSetting("service.surveysSkipped", [...((st.settings["service.surveysSkipped"] as string[] | undefined) ?? []), survey.id].slice(-50));
    setSurvey(null);
  };

  if (!survey && !askUsage) return null;
  return createPortal(
    <Glass material="menu" layer={LAYER.floating} className="svc-card" radius="var(--r-popover)" role="dialog" aria-label={survey ? "A question from Worlds" : "Usage counts"}>
      <div className="svc-card-head">
        <Icon name={survey ? "comment" : "graph"} size={18} />
        <span className="svc-card-title">{survey ? "A question from Worlds" : "Help us improve Worlds"}</span>
        <IconButton icon="close" label="Not Now" onClick={survey ? skip : () => (setUsageCounts(false), setAskUsage(false))} />
      </div>
      {survey ? (
        <>
          <p className="svc-card-text bidi" translate="no">
            {pick(survey.question)}
          </p>
          {survey.choices.length ? (
            <div className="svc-choices">
              {survey.choices.map((c, i) => (
                <Button key={i} variant="plain" size="compact" disabled={busy} onClick={() => answer({ choice: i })}>
                  <span translate="no">{pick(c)}</span>
                </Button>
              ))}
            </div>
          ) : (
            <div className="svc-answer">
              <textarea className="field" rows={3} maxLength={1000} value={text} aria-label="Your answer" onChange={(e) => setText(e.target.value)} />
              <Button variant="tinted" size="compact" loading={busy} disabled={!text.trim()} onClick={() => answer({ text: text.trim() })}>
                Send
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="svc-card-text">
            Once a day Worlds can send counts: how many pages, which kinds of pages and features are in use, the version, language and theme. Never titles, text or files. You can
            change this in Settings, Account.
          </p>
          <div className="svc-choices">
            <Button variant="plain" size="compact" onClick={() => (setUsageCounts(false), setAskUsage(false))}>
              Don't Send
            </Button>
            <Button variant="tinted" size="compact" onClick={() => (setUsageCounts(true), setAskUsage(false))}>
              Send Counts
            </Button>
          </div>
        </>
      )}
    </Glass>,
    document.body,
  );
}

// ---- feedback: an idea or a problem ------------------------------------------

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function FeedbackSheet({ initial, onClose }: { initial: "idea" | "problem"; onClose: () => void }) {
  const signedIn = useAccount((s) => s.view?.status === "active");
  const [mode, setMode] = useState(initial);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [area, setArea] = useState("");
  const [details, setDetails] = useState(true);
  const [pictures, setPictures] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "idea") {
        const s = await serviceApi.suggest(title.trim(), body.trim());
        setDone(`Your idea is #${s.number}. When the team puts it on the board, others can vote for it.`);
      } else {
        const files: string[] = [];
        for (const f of pictures) files.push((await serviceApi.uploadPicture(f.type, await readBase64(f))).key);
        const fields: Record<string, string> = { platform: appPlatform(), version: APP_VERSION };
        if (area) fields.area = area;
        if (details) {
          fields.system = navigator.userAgent.slice(0, 300);
          fields.language = navigator.language;
          fields.screen = `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`;
          fields.pages = String(Object.values(useStore.getState().pages).filter((p) => !p.deletedAt).length);
        }
        const r = await serviceApi.report({ subject: title.trim(), body: body.trim(), files, fields });
        setDone(`Request ${r.ref} is open. Replies come to your email from support@enterworlds.space and to your notifications here.`);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  if (done) {
    return (
      <Modal onClose={onClose} width={440} bare className="acct-modal">
        <div className="acct-flow">
          <div className="acct-hero-icon is-done">
            <Icon name="success" size={24} />
          </div>
          <h2 className="acct-title">{mode === "idea" ? "Thanks for the idea" : "We got it"}</h2>
          <p className="acct-text">{done}</p>
          <div className="acct-actions">
            <Button variant="tinted" size="large" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Send Feedback"
      onClose={onClose}
      width={520}
      footer={
        signedIn ? (
          <>
            <Button variant="quiet" onClick={() => void openExternal(mode === "idea" ? `${SUPPORT_URL}/ideas` : SUPPORT_URL)}>
              {mode === "idea" ? "See Other Ideas" : "Help Center"}
            </Button>
            <span className="svc-spacer" />
            <Button variant="tinted" loading={busy} disabled={!title.trim() || (mode === "problem" && !body.trim())} onClick={send}>
              Send
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="svc-form">
        <Segmented
          label="Kind"
          value={mode}
          onChange={setMode}
          size="standard"
          options={[
            { value: "idea", label: "Suggest an Idea", icon: "reminder" },
            { value: "problem", label: "Report a Problem", icon: "warning" },
          ]}
        />
        {!signedIn ? (
          <div className="acct-notice">
            <Icon name="user" size={16} />
            <div className="acct-notice-text">
              Sign in to send it from here, or use the help center in your browser with your email.
              <div className="acct-notice-action">
                <Button variant="tinted" size="compact" icon="openExternal" onClick={() => void openExternal(mode === "idea" ? `${SUPPORT_URL}/ideas` : `${SUPPORT_URL}/new`)}>
                  Open Help Center
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <label className="svc-label">
              {mode === "idea" ? "Your idea in a line" : "What went wrong, in a line"}
              <input className="field" autoFocus value={title} maxLength={mode === "idea" ? 140 : 160} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {mode === "problem" && (
              <label className="svc-label">
                Where
                <select className="field" value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Not sure</option>
                  <option value="editor">Pages and the editor</option>
                  <option value="sync">Sync and sharing</option>
                  <option value="account">Account and sign in</option>
                  <option value="ai">Claude</option>
                  <option value="drawing">Drawing</option>
                  <option value="packs">Packs</option>
                  <option value="other">Something else</option>
                </select>
              </label>
            )}
            <label className="svc-label">
              {mode === "idea" ? "Why it would help (optional)" : "What you did, what you expected, and what happened"}
              <textarea className="field" rows={5} maxLength={mode === "idea" ? 4000 : 10_000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            {mode === "problem" && (
              <>
                <div className="svc-pictures">
                  {pictures.map((p, i) => (
                    <span key={i} className="svc-picture">
                      <Icon name="image" size={14} />
                      <span className="svc-picture-name" translate="no">
                        {p.name}
                      </span>
                      <IconButton icon="close" label="Remove" onClick={() => setPictures(pictures.filter((_, j) => j !== i))} />
                    </span>
                  ))}
                  {pictures.length < 6 && (
                    <Button variant="quiet" size="compact" icon="image" onClick={() => fileRef.current?.click()}>
                      Add Screenshot
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      const add = [...(e.target.files ?? [])].filter((f) => f.size <= 10 * 1024 * 1024);
                      setPictures([...pictures, ...add].slice(0, 6));
                      e.target.value = "";
                    }}
                  />
                </div>
                <label className="svc-check">
                  <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
                  <span>
                    Include technical details: Worlds {APP_VERSION} on {appPlatform()}, the system, screen size and how many pages you have. Never their titles or text.
                  </span>
                </label>
              </>
            )}
            {error && <p className="acct-error is-left">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---- messages from the Worlds team -------------------------------------------

function MessagesSheet({ onClose }: { onClose: () => void }) {
  const [threads, setThreads] = useState<TeamThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => serviceApi.messages().then(setThreads, (e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
  }, []);

  const reply = async (t: TeamThread) => {
    const text = drafts[t.id]?.trim();
    if (!text) return;
    setBusy(t.id);
    try {
      await serviceApi.replyMessage(t.id, text);
      setDrafts({ ...drafts, [t.id]: "" });
      await load();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
    setBusy(null);
  };

  return (
    <Modal title="Messages from Worlds" onClose={onClose} width={540}>
      <div className="svc-threads">
        {error ? (
          <p className="acct-error is-left">{error}</p>
        ) : !threads ? (
          <p className="svc-empty">Loading</p>
        ) : !threads.length ? (
          <p className="svc-empty">No messages. When the Worlds team writes to you, it shows up here and in your notifications.</p>
        ) : (
          threads.map((t) => (
            <section key={t.id} className="svc-thread">
              <h3 className="svc-thread-title bidi" translate="no">
                {t.subject}
              </h3>
              {t.messages.map((m) => (
                <div key={m.id} className={`svc-bubble is-${m.author}`}>
                  <div className="svc-bubble-body bidi" dir="auto" translate="no">
                    {m.body}
                  </div>
                  <div className="svc-bubble-meta">
                    <span>{m.author === "team" ? "Worlds team" : "You"}</span>
                    <span>{relTime(m.createdAt)}</span>
                  </div>
                </div>
              ))}
              {t.status !== "closed" ? (
                <div className="svc-answer">
                  <textarea
                    className="field"
                    rows={2}
                    maxLength={4000}
                    value={drafts[t.id] ?? ""}
                    aria-label="Reply"
                    placeholder="Reply"
                    onChange={(e) => setDrafts({ ...drafts, [t.id]: e.target.value })}
                  />
                  <Button variant="tinted" size="compact" loading={busy === t.id} disabled={!drafts[t.id]?.trim()} onClick={() => reply(t)}>
                    Send
                  </Button>
                </div>
              ) : (
                <p className="svc-empty">This conversation is closed.</p>
              )}
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}

// ---- deleting the account ----------------------------------------------------

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const view = useAccount((s) => s.view);
  const apply = useAccount((s) => s.apply);
  const email = view?.account?.email ?? "";
  const [step, setStep] = useState<"explain" | "code">("explain");
  const [days, setDays] = useState(30);
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serviceApi.deletion().then(
      (d) => {
        setDays(d.days);
        setBlocked(d.sharedWorkspaces);
      },
      () => undefined,
    );
  }, []);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await accountApi.emailStart(email);
      setChallengeId(r.challengeId);
      setStep("code");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await serviceApi.scheduleDeletion(challengeId, code.replace(/\s/g, ""));
      // Every device was signed out by the service; this one follows.
      const v = await accountApi.signOut().catch(() => null);
      if (v) apply(v);
      onClose();
      useStore.getState().toast({ message: `Your account will be deleted on ${new Date(r.dueAt).toLocaleDateString()}. Sign in before then to keep it.` });
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} width={460} bare className="acct-modal">
      <div className="acct-flow">
        <div className="acct-hero-icon">
          <Icon name="delete" size={24} />
        </div>
        <h2 className="acct-title">Delete your Worlds account?</h2>
        {step === "explain" ? (
          <>
            <p className="acct-text">
              Every device signs out now, and your account, profile, published pages and Team membership are erased in {days} days. Until then you can sign in and cancel it.
              Pages on this PC stay on this PC.
            </p>
            {blocked.length > 0 && (
              <div className="acct-notice is-warning">
                <Icon name="warning" size={16} />
                <div className="acct-notice-text">
                  You own shared workspaces: <span translate="no">{blocked.map((w) => w.name).join(", ")}</span>. Hand them to someone else or delete them first, in Settings,
                  Account, Workspaces.
                </div>
              </div>
            )}
            {error && <p className="acct-error">{error}</p>}
            <div className="acct-actions">
              <Button variant="plain" size="large" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" size="large" loading={busy} disabled={blocked.length > 0} onClick={sendCode}>
                Email Me a Code
              </Button>
            </div>
            <button type="button" className="acct-link" onClick={() => void openExternal(`https://enterworlds.space/${uiLanguage() === "en" ? "en/" : ""}docs/account-deletion/`)}>
              What is deleted and when
            </button>
          </>
        ) : (
          <>
            <p className="acct-text">
              We sent a 6 digit code to <span className="acct-strong isolate">{email}</span>. Enter it to confirm.
            </p>
            <input
              className="field acct-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              aria-label="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.replace(/\s/g, "").length === 6 && confirm()}
            />
            {error && <p className="acct-error">{error}</p>}
            <div className="acct-actions">
              <Button variant="plain" size="large" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" size="large" loading={busy} disabled={code.replace(/\s/g, "").length !== 6} onClick={confirm}>
                Delete Account
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
