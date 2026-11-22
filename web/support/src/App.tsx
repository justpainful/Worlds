import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ban, Bug, CircleUser, Ellipsis, Flag, KeyRound, Lightbulb, ShieldAlert, type LucideIcon } from "lucide-react";
import { ApiError, call, confirmEmail, currentEmail, onSession, picture, signOut, startEmail, upload, type Kind, type Message, type Request, type Status } from "./api";
import { errorText, fmtDate, setLang, t, useLang, type Key } from "./i18n";
import { popular, search, type Article } from "./search";
import { Button, Chip, Empty, Field, Icon, IconButton, Popup, Section, Spinner, Toasts, toast } from "../../admin/src/ui";

// ---------------------------------------------------------------------------
// Paths: /, /new, /new/<kind>, /requests, /requests/<number>
// ---------------------------------------------------------------------------

function usePath(): string {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return p;
}

export function nav(to: string) {
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function A({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        nav(to);
      }}
    >
      {children}
    </a>
  );
}

const useEmail = () => useSyncExternalStore(onSession, currentEmail);

const KINDS: { kind: Kind; icon: LucideIcon }[] = [
  { kind: "problem", icon: Bug },
  { kind: "account", icon: CircleUser },
  { kind: "recovery", icon: KeyRound },
  { kind: "deletion", icon: Ban },
  { kind: "report", icon: Flag },
  { kind: "security", icon: ShieldAlert },
  { kind: "suggestion", icon: Lightbulb },
  { kind: "other", icon: Ellipsis },
];

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

type Theme = "system" | "light" | "dark";
function initialTheme(): Theme {
  try {
    const v = localStorage.getItem("worlds.support.theme");
    if (v === "light" || v === "dark") return v;
  } catch {
    // Automatic.
  }
  return "system";
}

export function App() {
  const lang = useLang();
  const path = usePath();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("worlds.support.theme", theme);
    } catch {
      // This visit.
    }
  }, [theme]);

  const [, section, arg] = path.split("/");
  let page: ReactNode;
  if (section === "new") page = <NewRequest kind={(KINDS.find((k) => k.kind === arg)?.kind ?? null) as Kind | null} />;
  else if (section === "requests" && arg) page = <RequestPage number={arg} />;
  else if (section === "requests") page = <MyRequests />;
  else page = <Home />;

  return (
    <div className="support">
      <header className="topbar glass">
        <A to="/" className="brand">
          <img src="/icon-256.png" alt="" width={28} height={28} />
          <span>{t("title")}</span>
        </A>
        <nav className="top-actions">
          <A to="/requests" className="btn btn-plain">
            <Icon name="tray" />
            <span className="hide-phone">{t("myRequests")}</span>
          </A>
          <Popup
            label={t("theme")}
            icon={theme === "dark" ? "moon" : theme === "light" ? "sun.max" : "circle.lefthalf.filled"}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: lang === "ar" ? "تلقائي" : "Automatic" },
              { value: "light", label: lang === "ar" ? "فاتح" : "Light" },
              { value: "dark", label: lang === "ar" ? "داكن" : "Dark" },
            ]}
          />
          <Button icon="character.bubble" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {t("language")}
          </Button>
        </nav>
      </header>
      <main className="support-main" key={lang}>
        {page}
      </main>
      <footer className="support-foot">
        <span>{t("footer")}</span>
        <span className="foot-links">
          <a href={lang === "en" ? "https://enterworlds.space/en/" : "https://enterworlds.space/"}>{t("site")}</a>
          <a href={lang === "en" ? "https://enterworlds.space/en/privacy/" : "https://enterworlds.space/privacy/"}>{t("privacy")}</a>
          <a href={lang === "en" ? "https://enterworlds.space/en/terms/" : "https://enterworlds.space/terms/"}>{t("terms")}</a>
          <a href="https://status.enterworlds.space/">{t("status")}</a>
        </span>
      </footer>
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function ArticleList({ items }: { items: Article[] }) {
  return (
    <div className="group">
      {items.map((a) => (
        <a key={a.url} href={a.url} className="row row-button has-icon article-row" target="_blank" rel="noopener">
          <span className="row-icon">
            <Icon name="text.document" />
          </span>
          <span className="row-main">
            <span className="row-label">{a.title}</span>
            {a.description && <span className="row-sub">{a.description}</span>}
          </span>
          <span className="row-trailing">
            <Icon name="arrow.up.right.square" size={14} />
          </span>
        </a>
      ))}
    </div>
  );
}

function KindCards() {
  return (
    <div className="kinds">
      {KINDS.map(({ kind, icon: I }) => (
        <A key={kind} to={`/new/${kind}${location.search}`} className={`kind-card ${kind === "security" ? "is-private" : ""}`}>
          <span className="kind-icon">
            <I size={22} strokeWidth={1.8} aria-hidden />
          </span>
          <span className="kind-text">
            <span className="kind-title">{t(`kind_${kind}` as Key)}</span>
            <span className="kind-desc">{t(`kind_${kind}_d` as Key)}</span>
          </span>
        </A>
      ))}
    </div>
  );
}

function Home() {
  const lang = useLang();
  const [q, setQ] = useState("");
  const results = useMemo(() => search(q, lang, 8), [q, lang]);
  return (
    <>
      <section className="hero">
        <h1>{t("heroTitle")}</h1>
        <p>{t("heroLead")}</p>
        <label className="search hero-search glass">
          <Icon name="magnifyingglass" size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        </label>
      </section>
      <div className="page-col">
        {q.trim().length > 1 && (
          <Section title={t("readArticle")}>
            {results.length ? <ArticleList items={results} /> : <Empty>{t("noArticles")}</Empty>}
          </Section>
        )}
        <section className="section">
          <div className="section-head">
            <h2>{t("chooseKind")}</h2>
          </div>
          <KindCards />
        </section>
        <Section title={t("popular")}>
          <ArticleList items={popular(lang)} />
        </Section>
        <p className="write-us">
          {t("orWrite")}{" "}
          <a href="mailto:support@enterworlds.space" dir="ltr">
            support@enterworlds.space
          </a>
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirming the email (a support session)
// ---------------------------------------------------------------------------

function EmailGate({ prefill, compact }: { prefill?: string; compact?: boolean }) {
  const lang = useLang();
  const [email, setEmail] = useState(prefill ?? "");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`gate ${compact ? "" : "group gate-box"}`}>
      {!challenge ? (
        <form
          className="gate-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) run(async () => setChallenge(await startEmail(email.trim(), lang)));
          }}
        >
          <Field label={t("yourEmail")} hint={t("yourEmailHint")}>
            <input className="input" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button type="submit" icon="envelope" busy={busy}>
            {t("sendCode")}
          </Button>
        </form>
      ) : (
        <form
          className="gate-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => confirmEmail(challenge, code));
          }}
        >
          <Field label={t("code")} hint={t("codeSent", { email })}>
            <input
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
          </Field>
          <Button type="submit" variant="accent" icon="checkmark" busy={busy} disabled={code.length !== 6}>
            {t("confirm")}
          </Button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A new request
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: Key;
  hint?: Key;
  type: "text" | "area" | "choice";
  options?: { value: string; label: Key }[];
  required?: boolean;
}

const PLATFORMS = ["windows", "macos", "linux", "iphone", "ipad", "android", "web"];
const PLATFORM_LABEL: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", iphone: "iPhone", ipad: "iPad", android: "Android", web: "Web" };

const FIELDS: Record<Kind, FieldDef[]> = {
  problem: [
    { key: "platform", label: "f_platform", type: "choice", required: true },
    { key: "version", label: "f_version", hint: "f_versionHint", type: "text" },
    { key: "steps", label: "f_steps", type: "area" },
    { key: "expected", label: "f_expected", type: "area" },
  ],
  account: [
    {
      key: "issue",
      label: "f_issue",
      type: "choice",
      required: true,
      options: [
        { value: "code", label: "issue_code" },
        { value: "passkey", label: "issue_passkey" },
        { value: "name", label: "issue_name" },
        { value: "signin", label: "issue_signin" },
        { value: "other", label: "issue_other" },
      ],
    },
    { key: "username", label: "f_username", type: "text" },
  ],
  recovery: [
    { key: "oldEmail", label: "f_oldEmail", type: "text", required: true },
    { key: "username", label: "f_username", type: "text" },
    { key: "devices", label: "f_devices", type: "area" },
    { key: "joined", label: "f_joined", type: "text" },
    { key: "workspaces", label: "f_workspaces", type: "area" },
  ],
  deletion: [
    {
      key: "request",
      label: "f_request",
      type: "choice",
      required: true,
      options: [
        { value: "delete", label: "req_delete" },
        { value: "export", label: "req_export" },
        { value: "web", label: "req_web" },
      ],
    },
    { key: "username", label: "f_username", type: "text" },
  ],
  report: [
    { key: "link", label: "f_link", type: "text", required: true },
    {
      key: "reason",
      label: "f_reason",
      type: "choice",
      required: true,
      options: [
        { value: "abuse", label: "reason_abuse" },
        { value: "impersonation", label: "reason_impersonation" },
        { value: "illegal", label: "reason_illegal" },
        { value: "scam", label: "reason_scam" },
        { value: "copyright", label: "reason_copyright" },
        { value: "other", label: "reason_other" },
      ],
    },
  ],
  security: [],
  suggestion: [],
  other: [],
};

function Pictures({ keys, setKeys }: { keys: string[]; setKeys: (k: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    const next = [...keys];
    for (const f of [...files].slice(0, 6 - keys.length)) {
      try {
        if (f.size > 10 * 1024 * 1024) throw new ApiError(400, "too_large", "");
        next.push(await upload(f));
      } catch (e) {
        toast(errorText(e), "error");
      }
    }
    setKeys(next);
    setBusy(false);
  };
  return (
    <Field label={`${t("attachments")} (${t("optional")})`} hint={t("attachHint")} as="div">
      <div className="thumbs">
        {keys.map((k) => (
          <span key={k} className="thumb-wrap">
            <Picture fileKey={k} />
            <IconButton icon="xmark" label={t("removePicture")} onClick={() => setKeys(keys.filter((x) => x !== k))} />
          </span>
        ))}
        {keys.length < 6 && (
          <Button icon="plus" busy={busy} onClick={() => input.current?.click()}>
            {t("addPicture")}
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => add(e.target.files)} />
    </Field>
  );
}

function Picture({ fileKey }: { fileKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    picture(fileKey)
      .then((x) => setUrl((u = x)))
      .catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [fileKey]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener" className="thumb">
      <img src={url} alt="" />
    </a>
  ) : (
    <span className="thumb is-empty" />
  );
}

function NewRequest({ kind }: { kind: Kind | null }) {
  const lang = useLang();
  const email = useEmail();
  const params = new URLSearchParams(location.search);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const k of ["platform", "version", "username", "link"]) if (params.get(k)) v[k] = params.get(k)!.slice(0, 200);
    if (v.platform && !PLATFORMS.includes(v.platform)) delete v.platform;
    return v;
  });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Request | null>(null);
  const hints = useMemo(() => (subject.trim().length > 3 ? search(subject, lang, 3) : []), [subject, lang]);

  if (!kind)
    return (
      <div className="page-col">
        <h1 className="page-title">{t("chooseKind")}</h1>
        <p className="page-lead">{t("chooseKindLead")}</p>
        <KindCards />
      </div>
    );

  if (sent)
    return (
      <div className="page-col done">
        <span className="done-icon">
          <Icon name="checkmark" size={30} />
        </span>
        <h1 className="page-title">{t("sentTitle", { ref: sent.ref })}</h1>
        <p className="page-lead">{t("sentLead")}</p>
        <div className="done-actions">
          <Button variant="accent" icon="tray" onClick={() => nav(`/requests/${sent.number}`)}>
            {t("openRequest")}
          </Button>
          <Button icon="chevron.left" onClick={() => nav("/")}>
            {t("backHome")}
          </Button>
        </div>
      </div>
    );

  const defs = FIELDS[kind];
  const missing = defs.some((d) => d.required && !values[d.key]?.trim()) || !subject.trim() || !body.trim();
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await call<Request>("POST", "/support/requests", { kind, subject: subject.trim(), body: body.trim(), fields: values, files, lang, via: params.get("via") === "app" ? "app" : "web" });
      setSent(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }));

  return (
    <div className="page-col">
      <A to="/new" className="back-link">
        <Icon name="chevron.left" size={14} />
        {t("chooseKind")}
      </A>
      <h1 className="page-title">{t(`kind_${kind}` as Key)}</h1>
      <p className="page-lead">{t(`kind_${kind}_d` as Key)}</p>
      {kind === "security" && <p className="callout">{t("securityNote")}</p>}
      {kind === "recovery" && <p className="callout">{t("recoveryNote")}</p>}

      <div className="group form">
        {defs.map((d) =>
          d.type === "choice" ? (
            <Field key={d.key} label={`${t(d.label)}${d.required ? "" : ` (${t("optional")})`}`} as="div">
              <Popup
                label={t(d.label)}
                value={values[d.key] ?? ""}
                onChange={(v) => set(d.key, v)}
                options={[
                  { value: "", label: "..." },
                  ...(d.key === "platform" ? PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] })) : (d.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }))),
                ]}
              />
            </Field>
          ) : (
            <Field key={d.key} label={`${t(d.label)}${d.required ? "" : ` (${t("optional")})`}`} hint={d.hint ? t(d.hint) : undefined}>
              {d.type === "area" ? (
                <textarea className="input" rows={3} dir="auto" value={values[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} maxLength={2000} />
              ) : (
                <input className="input" dir="auto" value={values[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} maxLength={300} />
              )}
            </Field>
          ),
        )}
        <Field label={t("subject")} hint={t("subjectHint")}>
          <input className="input" dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required />
        </Field>
        {hints.length > 0 && (
          <div className="hints">
            <p className="field-hint">{t("maybeHelps")}</p>
            <ArticleList items={hints} />
          </div>
        )}
        <Field label={t("description")} hint={t("descriptionHint")}>
          <textarea className="input" rows={6} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} required />
        </Field>
        {email && <Pictures keys={files} setKeys={setFiles} />}
      </div>

      <div className="submit-area">
        {email ? (
          <>
            <p className="muted">
              {t("confirmedAs", { email })}{" "}
              <button type="button" className="link-btn" onClick={signOut}>
                {t("change")}
              </button>
            </p>
            <Button variant="accent" icon="envelope" busy={busy} disabled={missing} onClick={submit}>
              {t("submit")}
            </Button>
          </>
        ) : (
          <EmailGate prefill={params.get("email") ?? undefined} />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My requests
// ---------------------------------------------------------------------------

const tone = (s: Status) => (s === "waiting" ? "accent" : s === "working" ? "warning" : s === "solved" ? "success" : "plain") as "accent" | "warning" | "success" | "plain";

function MyRequests() {
  const email = useEmail();
  const [list, setList] = useState<Request[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!email) return;
    call<{ requests: Request[] }>("GET", "/support/me")
      .then((r) => setList(r.requests))
      .catch(setError);
  }, [email]);
  return (
    <div className="page-col">
      <div className="page-head">
        <h1 className="page-title">{t("myRequests")}</h1>
        {email && (
          <Button icon="rectangle.portrait.and.arrow.right" onClick={signOut}>
            {t("signOut")}
          </Button>
        )}
      </div>
      {!email ? (
        <>
          <p className="page-lead">{t("signInLead")}</p>
          <EmailGate />
        </>
      ) : error ? (
        <p className="form-error">{errorText(error)}</p>
      ) : !list ? (
        <div className="state">
          <Spinner />
        </div>
      ) : (
        <>
          <p className="page-lead">{t("confirmedAs", { email })}</p>
          <div className="group">
            {list.length ? (
              list.map((r) => (
                <A key={r.id} to={`/requests/${r.number}`} className="row row-button req-row">
                  <span className="row-main">
                    <span className="row-label">
                      <span className="ref">{r.ref}</span> <bdi dir="auto">{r.subject}</bdi>
                    </span>
                    <span className="row-sub">
                      {t(`kind_${r.kind}` as Key)} · {fmtDate(r.updatedAt)}
                    </span>
                  </span>
                  <Chip tone={tone(r.status)}>{t(`st_${r.status}` as Key)}</Chip>
                </A>
              ))
            ) : (
              <Empty>{t("noRequests")}</Empty>
            )}
          </div>
          <div className="more">
            <Button variant="accent" icon="plus" onClick={() => nav("/new")}>
              {t("newRequest")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RequestPage({ number }: { number: string }) {
  const email = useEmail();
  const [r, setR] = useState<(Request & { messages: Message[] }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () =>
    call<Request & { messages: Message[] }>("GET", `/support/requests/${encodeURIComponent(number)}`)
      .then((x) => (setR(x), setError(null)))
      .catch(setError);
  useEffect(() => {
    if (email) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, number]);

  if (!email)
    return (
      <div className="page-col">
        <h1 className="page-title">W-{number}</h1>
        <p className="page-lead">{t("signInLead")}</p>
        <EmailGate />
      </div>
    );
  if (error) return <div className="page-col"><p className="form-error">{errorText(error)}</p></div>;
  if (!r)
    return (
      <div className="state">
        <Spinner />
      </div>
    );

  const reply = async () => {
    setBusy(true);
    try {
      await call("POST", `/support/requests/${r.number}/messages`, { body: text.trim(), files });
      setText("");
      setFiles([]);
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const rate = async (solved: boolean) => {
    try {
      await call("POST", `/support/requests/${r.number}/rate`, { solved });
      toast(t("thanks"));
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="page-col">
      <A to="/requests" className="back-link">
        <Icon name="chevron.left" size={14} />
        {t("myRequests")}
      </A>
      <div className="page-head">
        <h1 className="page-title">
          <span className="ref">{r.ref}</span> <bdi dir="auto">{r.subject}</bdi>
        </h1>
        <Chip tone={tone(r.status)}>{t(`st_${r.status}` as Key)}</Chip>
      </div>
      <p className="page-lead">
        {t(`kind_${r.kind}` as Key)} · {fmtDate(r.createdAt)}
      </p>
      <div className="group">
        <div className="thread">
          {r.messages.map((m) =>
            m.author === "system" ? (
              <div key={m.id} className="bubble-system">
                <Icon name="info.circle" size={14} /> {m.body === "closed_after_a_week" ? t("systemClosed") : m.body}
              </div>
            ) : (
              <div key={m.id} className={`bubble ${m.author === "team" ? "bubble-team" : "bubble-person"}`}>
                <div className="bubble-head">
                  {m.author === "team" ? t("team") : t("you")}
                  <span className="muted"> · {fmtDate(m.createdAt)}</span>
                </div>
                <div className="bubble-body" dir="auto">
                  {m.body}
                </div>
                {m.files.length > 0 && (
                  <div className="thumbs">
                    {m.files.map((f) => (
                      <Picture key={f} fileKey={f} />
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        {(r.status === "waiting" || (r.status === "solved" && r.rating === null)) && (
          <div className="rate">
            <span>{t("solvedQ")}</span>
            <Button icon="checkmark" onClick={() => rate(true)}>
              {t("yes")}
            </Button>
            <Button icon="xmark" onClick={() => rate(false)}>
              {t("no")}
            </Button>
          </div>
        )}
        <div className="composer">
          <textarea className="input" rows={4} dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("writeReply")} aria-label={t("writeReply")} maxLength={10000} />
          <Pictures keys={files} setKeys={setFiles} />
          <div className="composer-actions">
            <Button variant="accent" icon="envelope" busy={busy} disabled={!text.trim()} onClick={reply}>
              {t("sendReply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

