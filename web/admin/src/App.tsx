import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, call, emailStart, emailSignIn, getCredential, isSignedIn, onSession, passkeySignIn, passkeysSupported, signOut, type Me, type Permission } from "./api";
import { errorText, fmtTime, setLang, t, useLang } from "./i18n";
import { Avatar, Button, Dialog, Field, Icon, Popup, Spinner, Toasts, toast } from "./ui";
import type { SymbolName } from "./symbols";
import { Overview } from "./views/Overview";
import { Accounts } from "./views/Accounts";
import { Log } from "./views/Log";
import { Team } from "./views/Team";
import { Support } from "./views/Support";
import { Names } from "./views/Names";
import { Content } from "./views/Content";
import { Community } from "./views/Community";
import { Control } from "./views/Control";

// ---------------------------------------------------------------------------
// Where we are: #/overview, #/accounts/<id>, #/log?user=<id>, #/team
// ---------------------------------------------------------------------------

export type View = "overview" | "accounts" | "support" | "content" | "community" | "control" | "log" | "names" | "team";
export interface Route {
  view: View;
  id?: string;
  params: URLSearchParams;
}

function parse(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [view, id] = path.split("/");
  const v = (["overview", "accounts", "support", "content", "community", "control", "log", "names", "team"] as View[]).includes(view as View) ? (view as View) : "overview";
  return { view: v, id: id ? decodeURIComponent(id) : undefined, params: new URLSearchParams(query ?? "") };
}

export function go(view: View, id?: string, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : "";
  location.hash = `/${view}${id ? `/${encodeURIComponent(id)}` : ""}${q}`;
}

function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

// ---------------------------------------------------------------------------
// Who is signed in, and the second check
// ---------------------------------------------------------------------------

interface AdminCtx {
  me: Me;
  can: (p: Permission) => boolean;
  /** Run an action; when the service asks for the second check, ask for it and run it again. */
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
  reloadMe: () => Promise<void>;
}
const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => useContext(Ctx)!;

function useSignedIn() {
  return useSyncExternalStore(onSession, isSignedIn);
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

type Theme = "system" | "light" | "dark";
function initialTheme(): Theme {
  try {
    const v = localStorage.getItem("worlds.admin.theme");
    if (v === "light" || v === "dark") return v;
  } catch {
    // Automatic.
  }
  return "system";
}
function applyTheme(th: Theme) {
  if (th === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", th);
  try {
    localStorage.setItem("worlds.admin.theme", th);
  } catch {
    // Kept for this visit.
  }
}

export function App() {
  useLang();
  const signedIn = useSignedIn();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <>
      {signedIn ? <Signed theme={theme} setTheme={setTheme} /> : <SignIn />}
      <Toasts />
    </>
  );
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

function SignIn({ notice }: { notice?: string }) {
  const lang = useLang();
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"passkey" | "send" | "code" | null>(null);
  const [error, setError] = useState(notice ?? "");

  const run = async (what: typeof busy, fn: () => Promise<void>) => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <img src="/icon-256.png" alt="" width={64} height={64} className="signin-icon" />
        <h1>{t("signInTitle")}</h1>
        <p className="signin-lead">{t("signInLead")}</p>
        {!challenge ? (
          <>
            {passkeysSupported() && (
              <Button variant="accent" icon="touchid" className="wide" busy={busy === "passkey"} onClick={() => run("passkey", passkeySignIn)}>
                {t("withPasskey")}
              </Button>
            )}
            <p className="signin-or">{t("orEmail")}</p>
            <form
              className="signin-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) run("send", async () => setChallenge(await emailStart(email.trim(), lang)));
              }}
            >
              <input className="input" type="email" autoComplete="username" dir="ltr" placeholder={t("email")} aria-label={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Button type="submit" icon="envelope" busy={busy === "send"}>
                {t("sendCode")}
              </Button>
            </form>
          </>
        ) : (
          <form
            className="signin-form"
            onSubmit={(e) => {
              e.preventDefault();
              run("code", () => emailSignIn(challenge, code));
            }}
          >
            <p className="signin-lead">{t("codeSent", { email })}</p>
            <input
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              placeholder="000000"
              aria-label={t("code")}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
            <Button type="submit" variant="accent" icon="checkmark" busy={busy === "code"} disabled={code.length !== 6}>
              {t("signIn")}
            </Button>
            <Button icon="chevron.left" onClick={() => (setChallenge(null), setCode(""))}>
              {t("back")}
            </Button>
          </form>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="link-btn" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {t("language")}
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// The second check (passkey with fingerprint, face or PIN; or an email code)
// ---------------------------------------------------------------------------

function Confirm({ me, onDone }: { me: Me; onDone: (ok: boolean) => void }) {
  const lang = useLang();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const withPasskey = () =>
    attempt(async () => {
      const { challengeId, options } = await call<{ challengeId: string; options: unknown }>("POST", "/admin/stepup/passkey/options", {});
      const response = await getCredential(options);
      await call("POST", "/admin/stepup/passkey/verify", { challengeId, response });
      onDone(true);
    });
  const sendCode = () => attempt(async () => setChallenge(await emailStart(me.user.email, lang)));
  const checkCode = () =>
    attempt(async () => {
      await call("POST", "/admin/stepup/email/verify", { challengeId: challenge, code });
      onDone(true);
    });

  return (
    <Dialog
      title={t("confirmTitle")}
      lead={challenge ? t("codeSent", { email: me.user.email }) : t("confirmLead")}
      onClose={() => onDone(false)}
      footer={
        <>
          <Button onClick={() => onDone(false)}>{t("cancel")}</Button>
          {challenge ? (
            <Button variant="accent" icon="checkmark" busy={busy} disabled={code.length !== 6} onClick={checkCode}>
              {t("confirm")}
            </Button>
          ) : me.hasPasskey && passkeysSupported() ? (
            <Button variant="accent" icon="touchid" busy={busy} onClick={withPasskey}>
              {t("confirmPasskey")}
            </Button>
          ) : (
            <Button variant="accent" icon="envelope" busy={busy} onClick={sendCode}>
              {t("sendCode")}
            </Button>
          )}
        </>
      }
    >
      {challenge ? (
        <Field label={t("code")}>
          <input
            className="input code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && checkCode()}
            autoFocus
          />
        </Field>
      ) : (
        me.hasPasskey &&
        passkeysSupported() && (
          <button type="button" className="link-btn" onClick={sendCode} disabled={busy}>
            {t("confirmEmail")}
          </button>
        )
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The signed-in shell
// ---------------------------------------------------------------------------

const NAV: { view: View; icon: SymbolName; label: () => string; need: Permission }[] = [
  { view: "overview", icon: "chart.bar.xaxis", label: () => t("overview"), need: "stats" },
  { view: "accounts", icon: "person.2", label: () => t("accounts"), need: "users.read" },
  { view: "support", icon: "tray", label: () => t("support"), need: "tickets" },
  { view: "content", icon: "text.document", label: () => t("content"), need: "content" },
  { view: "community", icon: "character.bubble", label: () => t("community"), need: "community" },
  { view: "control", icon: "gauge.with.dots.needle.33percent", label: () => t("control"), need: "control.read" },
  { view: "log", icon: "list.bullet.rectangle", label: () => t("log"), need: "audit" },
  { view: "names", icon: "at", label: () => t("names"), need: "names" },
  { view: "team", icon: "person.badge.key", label: () => t("team"), need: "users.read" },
];

function Signed({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const lang = useLang();
  const route = useRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<((ok: boolean) => void) | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await call<Me>("GET", "/admin/me"));
      setFailure(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "not_admin") {
        await signOut();
        toast(t("notTeam"), "error");
        return;
      }
      setFailure(errorText(e));
    }
  }, []);
  useEffect(() => {
    reloadMe();
  }, [reloadMe]);

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "step_up_required") throw e;
        const ok = await new Promise<boolean>((resolve) => setConfirming(() => resolve));
        setConfirming(null);
        if (!ok) throw new ApiError(0, "cancelled", "Cancelled.");
        await reloadMe();
        toast(t("confirmed"));
        return fn();
      }
    },
    [reloadMe],
  );

  if (failure && !me)
    return (
      <main className="signin">
        <div className="signin-card">
          <p className="form-error">{failure}</p>
          <Button icon="arrow.clockwise" onClick={reloadMe}>
            {t("retry")}
          </Button>
          <Button icon="rectangle.portrait.and.arrow.right" onClick={signOut}>
            {t("signOut")}
          </Button>
        </div>
      </main>
    );
  if (!me)
    return (
      <main className="signin">
        <Spinner />
      </main>
    );

  const can = (p: Permission) => me.permissions.includes(p);
  const nav = NAV.filter((n) => can(n.need));
  const view = nav.some((n) => n.view === route.view) ? route.view : (nav[0]?.view ?? "accounts");

  return (
    <Ctx.Provider value={{ me, can, guard, reloadMe }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <img src="/icon-256.png" alt="" width={28} height={28} />
            <span>{t("appName")}</span>
          </div>
          <nav aria-label={t("appName")}>
            {nav.map((n) => (
              <a key={n.view} href={`#/${n.view}`} className={`side-row ${view === n.view ? "is-on" : ""}`} aria-current={view === n.view ? "page" : undefined}>
                <Icon name={n.icon} />
                <span>{n.label()}</span>
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className="who">
              <Avatar name={me.user.displayName} url={me.user.avatarUrl} size={30} />
              <span className="who-text">
                <span className="who-name">{me.user.displayName}</span>
                <span className="who-role">
                  {t(`role_${me.role}`)}
                  {me.stepUpUntil && me.stepUpUntil > Date.now() ? ` · ${t("confirmedUntil", { time: fmtTime(me.stepUpUntil) })}` : ""}
                </span>
              </span>
            </div>
            <div className="side-controls">
              <Popup
                label={t("theme")}
                icon={theme === "dark" ? "moon" : theme === "light" ? "sun.max" : "circle.lefthalf.filled"}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: t("themeSystem") },
                  { value: "light", label: t("themeLight") },
                  { value: "dark", label: t("themeDark") },
                ]}
              />
              <Button icon="character.bubble" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
                {t("language")}
              </Button>
              <Button icon="rectangle.portrait.and.arrow.right" onClick={signOut}>
                {t("signOut")}
              </Button>
            </div>
          </div>
        </aside>
        <div className="content">
          {view === "overview" && <Overview />}
          {view === "accounts" && <Accounts id={route.id} />}
          {view === "support" && <Support id={route.id} />}
          {view === "log" && <Log params={route.params} />}
          {view === "content" && <Content />}
          {view === "community" && <Community />}
          {view === "control" && <Control />}
          {view === "names" && <Names />}
          {view === "team" && <Team />}
        </div>
        <nav className="tabbar glass" aria-label={t("appName")}>
          {nav.map((n) => (
            <a key={n.view} href={`#/${n.view}`} className={`tab ${view === n.view ? "is-on" : ""}`} aria-current={view === n.view ? "page" : undefined}>
              <Icon name={n.icon} size={20} />
              <span>{n.label()}</span>
            </a>
          ))}
        </nav>
      </div>
      {confirming && <Confirm me={me} onDone={confirming} />}
    </Ctx.Provider>
  );
}
