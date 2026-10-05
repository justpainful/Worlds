import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

/**
 * Keeps Claude Code signed in. Its normal login is short-lived and refreshes
 * itself, which fails now and then and signs the user out. A long-lived
 * token (`claude setup-token`, about a year) needs no refreshing; Worlds
 * keeps it in Windows Credential Manager and hands it to every run.
 */
export function StaySignedIn({ compact = false }: { compact?: boolean }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    api.aiTokenStatus().then((s) => setSaved(s.saved)).catch(() => setSaved(false));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.aiTokenSave(token);
      setSaved(true);
      setToken("");
      toast({ message: "Claude stays signed in now", tone: "success" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (saved === null) return null;

  if (saved && !compact) {
    return (
      <div className="stay-signed-in">
        <span className="ok-text">
          <Icon name="success" size={14} /> Signed in with a long-lived token, kept in Windows Credential Manager.
        </span>
        <Button
          variant="quiet"
          size="compact"
          onClick={async () => {
            await api.aiTokenClear();
            setSaved(false);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className={`stay-signed-in ${compact ? "is-compact" : ""}`}>
      <ol className="ssi-steps">
        <li>
          <Button
            variant="plain"
            size="compact"
            onClick={async () => {
              try {
                await api.aiTokenOpenSetup();
                setOpened(true);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Open Claude Sign-In
          </Button>
          <span className="ssi-hint">{opened ? "Finish in your browser, then copy the token the window shows (it starts with sk-ant-)." : "A window opens and your browser asks you to sign in once."}</span>
        </li>
        <li className="ssi-paste">
          <input
            className="field"
            dir="ltr"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the token here"
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && token && save()}
          />
          <Button variant="tinted" size="compact" loading={busy} disabled={!token} onClick={save}>
            Stay Signed In
          </Button>
        </li>
      </ol>
      {error && <div className="bad-text ssi-error">{error}</div>}
    </div>
  );
}
