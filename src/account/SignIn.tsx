import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { accountApi, type AccountView } from "./api";
import { useAccount } from "./store";

type Step =
  | { kind: "choose" }
  | { kind: "email"; create: boolean }
  | { kind: "code"; email: string; challengeId: string; create: boolean; name: string }
  | { kind: "passkey" }
  | { kind: "welcome"; created: boolean };

/**
 * Sign in or create an account. Passkeys first (Windows Hello in the
 * browser), an emailed code as the fallback and for new devices.
 */
export function SignInFlow({ start = "choose", onDone, onCancel }: { start?: "choose" | "create" | "signin"; onDone: () => void; onCancel?: () => void }) {
  const view = useAccount((s) => s.view);
  const apply = useAccount((s) => s.apply);
  const [step, setStep] = useState<Step>(start === "create" ? { kind: "email", create: true } : start === "signin" ? { kind: "choose" } : { kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step.kind === "code") codeRef.current?.focus();
  }, [step.kind]);

  if (view && !view.configured) return <ServerNeeded />;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = (v: AccountView, created: boolean) => {
    apply(v);
    setStep({ kind: "welcome", created });
  };

  if (step.kind === "welcome") {
    return (
      <div className="acct-flow">
        <div className="acct-hero-icon is-done">
          <Icon name="check" size={26} />
        </div>
        <h2 className="acct-title">{step.created ? "Your account is ready" : "You are signed in"}</h2>
        <p className="acct-text">
          {step.created
            ? "Add a passkey so this PC and your others can sign in with Windows Hello, your face, fingerprint or PIN."
            : "Your Team workspaces are in the menu at the top of the sidebar."}
        </p>
        <div className="acct-actions">
          {step.created && (
            <Button variant="tinted" size="large" icon="lock" onClick={() => act(async () => void (await accountApi.passkeyAdd()))} loading={busy}>
              Add a Passkey
            </Button>
          )}
          <Button variant={step.created ? "quiet" : "tinted"} size="large" onClick={onDone}>
            {step.created ? "Not Now" : "Done"}
          </Button>
        </div>
        {error && <p className="acct-error">{error}</p>}
      </div>
    );
  }

  if (step.kind === "passkey") {
    return (
      <div className="acct-flow">
        <div className="acct-hero-icon">
          <Icon name="loading" size={24} className="spin" />
        </div>
        <h2 className="acct-title">Continue in your browser</h2>
        <p className="acct-text">Your browser opened to confirm your passkey with Windows Hello. Worlds signs you in as soon as you finish.</p>
        <div className="acct-actions">
          <Button variant="quiet" onClick={() => setStep({ kind: "choose" })}>
            Use an Email Code Instead
          </Button>
        </div>
      </div>
    );
  }

  if (step.kind === "code") {
    const verify = () =>
      act(async () => {
        const v = await accountApi.emailVerify(step.challengeId, code.replace(/\s+/g, ""), step.create ? step.name : undefined);
        signedIn(v, !!v.created);
      });
    return (
      <div className="acct-flow">
        <h2 className="acct-title">Enter the code</h2>
        <p className="acct-text">
          We sent a 6 digit code to <span className="acct-strong isolate">{step.email}</span>. It works for 10 minutes.
        </p>
        <input
          ref={codeRef}
          className="field acct-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000000"
          aria-label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && code.replace(/\s/g, "").length === 6 && verify()}
        />
        {error && <p className="acct-error">{error}</p>}
        <div className="acct-actions">
          <Button variant="tinted" size="large" loading={busy} disabled={code.replace(/\s/g, "").length !== 6} onClick={verify}>
            Continue
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await accountApi.emailStart(step.email);
                setStep({ ...step, challengeId: r.challengeId });
                setCode("");
              })
            }
          >
            Send a New Code
          </Button>
        </div>
      </div>
    );
  }

  if (step.kind === "email") {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (!step.create || name.trim().length > 0);
    const send = () =>
      act(async () => {
        const r = await accountApi.emailStart(email.trim());
        setStep({ kind: "code", email: email.trim(), challengeId: r.challengeId, create: step.create, name: name.trim() });
      });
    return (
      <div className="acct-flow">
        <h2 className="acct-title">{step.create ? "Create your account" : "Sign in with email"}</h2>
        <p className="acct-text">
          {step.create
            ? "Your name is what people see when you share pages. Your email is for sign-in codes and recovery."
            : "We will email you a code. Use this on a new PC or when your passkey is not at hand."}
        </p>
        <div className="acct-fields">
          {step.create && (
            <input
              className="field"
              placeholder="Your name"
              aria-label="Your name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          )}
          <input
            className="field"
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoFocus={!step.create}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && send()}
          />
        </div>
        {error && <p className="acct-error">{error}</p>}
        <div className="acct-actions">
          <Button variant="tinted" size="large" loading={busy} disabled={!valid} onClick={send}>
            Send Code
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => setStep({ kind: "choose" })}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="acct-flow">
      <div className="acct-hero-icon">
        <Icon name="users" size={24} />
      </div>
      <h2 className="acct-title">Sign in to Worlds</h2>
      <p className="acct-text">An account lets you join Team workspaces and work on pages with other people. Your Personal pages stay on this PC.</p>
      <div className="acct-actions is-stacked">
        <Button
          variant="tinted"
          size="large"
          icon="lock"
          loading={busy}
          onClick={() => {
            setStep({ kind: "passkey" });
            act(async () => {
              const v = await accountApi.passkeySignIn();
              signedIn(v, false);
            }).finally(() => setStep((s) => (s.kind === "passkey" ? { kind: "choose" } : s)));
          }}
        >
          Sign In with a Passkey
        </Button>
        <Button variant="plain" size="large" disabled={busy} onClick={() => setStep({ kind: "email", create: false })}>
          Sign In with an Email Code
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => setStep({ kind: "email", create: true })}>
          Create an Account
        </Button>
      </div>
      {error && <p className="acct-error">{error}</p>}
      {onCancel && (
        <button type="button" className="acct-link" onClick={onCancel}>
          Not Now
        </button>
      )}
    </div>
  );
}

function ServerNeeded() {
  return (
    <div className="acct-flow">
      <div className="acct-hero-icon">
        <Icon name="server" size={24} />
      </div>
      <h2 className="acct-title">Accounts are not set up yet</h2>
      <p className="acct-text">
        This copy of Worlds has no account server. Everything works on this PC. To use accounts, add a server address in Settings, Account.
      </p>
    </div>
  );
}
