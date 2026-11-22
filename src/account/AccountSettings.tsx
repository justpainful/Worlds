import { useCallback, useEffect, useState } from "react";
import "./account.css";
import { errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { confirmDialog } from "../ui/Modal";
import { Avatar, relTime, Spinner } from "../ui/misc";
import { accountApi, ROLE_LABEL, type Device, type Passkey } from "./api";
import { startAccount, useAccount } from "./store";
import { SignInFlow } from "./SignIn";
import { Group, Notice, Row, WorkspaceTile } from "./parts";
import { isWeb } from "../lib/api";
import { save } from "../lib/dialog";
import { openExternal } from "../lib/links";
import { appPlatform } from "../appVersion";
import { openFeedback, useServiceUi } from "./ServiceHost";
import { serviceApi, setUsageCounts, SUPPORT_URL, type Deletion } from "./service";

/** Settings > Account: who you are, passkeys, devices, workspaces, server, sign out. */
export function AccountSettings() {
  const view = useAccount((s) => s.view);
  useEffect(() => startAccount(), []);
  if (!view) return <Spinner />;
  if (view.status === "signed_out") {
    return (
      <>
        <Group title="Account" note="Without an account Worlds works entirely on this PC. With one you can join Team workspaces and share pages.">
          <div className="acct-settings-flow">
            <SignInFlow onDone={() => {}} />
          </div>
        </Group>
        <HelpGroup signedIn={false} />
        <ServerGroup />
      </>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const view = useAccount((s) => s.view)!;
  const apply = useAccount((s) => s.apply);
  const run = useAccount((s) => s.run);
  const open = useAccount((s) => s.open);
  const account = view.account!;
  const username = useStore((s) => s.profile?.handle);
  const expired = view.status === "expired";
  const [name, setName] = useState(account.displayName);
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => setName(account.displayName), [account.displayName]);

  const sync = async () => {
    setSyncing(true);
    const v = await run(() => accountApi.sync());
    if (v) {
      apply(v);
      if (v.error) useStore.getState().toast({ message: v.error, tone: v.errorCode === "offline" ? "info" : "error" });
    }
    setSyncing(false);
  };

  return (
    <>
      {!expired && <PendingDeletion />}
      {expired && (
        <Notice icon="warning" tone="warning">
          This PC was signed out by the server (the device was removed or the sign-in expired). Your pages are safe here. Sign in again to reach your Team
          workspaces.
          <div className="acct-notice-action">
            <Button variant="tinted" size="compact" onClick={() => open({ kind: "signin", start: "signin" })}>
              Sign In Again
            </Button>
          </div>
        </Notice>
      )}
      <Group title="Account">
        <div className="acct-me">
          <Avatar name={account.displayName || account.email} size={52} />
          <div className="acct-me-text">
            {editing ? (
              <input
                className="field"
                autoFocus
                value={name}
                maxLength={80}
                aria-label="Name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setName(account.displayName);
                  }
                  if (e.key === "Enter" && name.trim()) {
                    const r = await run(() => accountApi.updateProfile({ displayName: name.trim() }));
                    if (r) useAccount.getState().load();
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <div className="acct-me-name bidi" translate={account.displayName ? "no" : undefined}>{account.displayName || "No name yet"}</div>
            )}
            <div className="acct-me-sub isolate">{username ? `@${username}  ·  ${account.email}` : account.email}</div>
          </div>
          {!editing && !expired && (
            <Button variant="plain" size="compact" onClick={() => setEditing(true)}>
              Edit Name
            </Button>
          )}
        </div>
        <Row label="Profile" hint="Your picture, banner and blocks live in your Worlds profile.">
          <Button variant="plain" size="compact" onClick={() => useStore.getState().open({ kind: "profile" })}>
            Open Profile
          </Button>
        </Row>
        <Row
          label={view.offline ? "Offline" : "Up to date"}
          hint={
            view.offline
              ? "Worlds keeps working. Changes to people and sharing wait for a connection."
              : account.lastSyncAt
                ? `Checked ${relTime(account.lastSyncAt)}`
                : "Not checked yet"
          }
        >
          <Button variant="plain" size="compact" loading={syncing} disabled={expired} onClick={sync}>
            Check Now
          </Button>
        </Row>
      </Group>

      {!expired && <Passkeys />}
      {!expired && <Devices />}

      <Group
        title="Workspaces"
        action={
          !expired ? (
            <Button variant="quiet" size="compact" icon="add" onClick={() => open({ kind: "create" })}>
              New
            </Button>
          ) : undefined
        }
      >
        <Row label="Personal" hint="Only on this PC" lead={<WorkspaceTile personal size={28} />} />
        {view.workspaces.map((w) => (
          <Row
            key={w.id}
            label={w.name}
            hint={`${ROLE_LABEL[w.role]}, ${w.memberCount} ${w.memberCount === 1 ? "person" : "people"}`}
            lead={<WorkspaceTile name={w.name} size={28} />}
          >
            <Button variant="plain" size="compact" disabled={expired} onClick={() => open({ kind: "members", workspaceId: w.id })}>
              People
            </Button>
          </Row>
        ))}
        {!expired && (
          <Row label="Join a workspace" hint="Paste an invite link someone sent you.">
            <Button variant="plain" size="compact" onClick={() => open({ kind: "join" })}>
              Join
            </Button>
          </Row>
        )}
      </Group>

      <HelpGroup signedIn={!expired} />
      {!expired && <PrivacyGroup />}

      <ServerGroup />

      {!expired && <DataGroup />}

      <Group note="Signing out keeps every page on this PC. Team pages are hidden until you sign in again.">
        <Row label="Sign out of Worlds on this PC" hint={account.deviceName}>
          <Button
            variant="danger"
            size="compact"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Sign out?",
                message: "Your pages stay on this PC. Team workspaces come back when you sign in again.",
                confirm: "Sign Out",
                danger: true,
              });
              if (ok) {
                const v = await run(() => accountApi.signOut(), "Signed out");
                if (v) apply(v);
              }
            }}
          >
            Sign Out
          </Button>
        </Row>
      </Group>
    </>
  );
}

function Passkeys() {
  const run = useAccount((s) => s.run);
  const [list, setList] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => accountApi.passkeys().then(setList, (e) => setError(errorMessage(e))), []);
  useEffect(() => {
    load();
    // Adding happens in the browser: look again when Worlds gets focus back.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  return (
    <Group
      title="Passkeys"
      note="A passkey signs you in with Windows Hello (face, fingerprint or PIN) or your phone. Without one, sign in with an emailed code."
      action={
        <Button variant="quiet" size="compact" icon="add" onClick={() => run(() => accountApi.passkeyAdd())}>
          Add
        </Button>
      }
    >
      {error ? (
        <Row label="Not available right now" hint={error} />
      ) : !list ? (
        <Row label="Loading" />
      ) : list.length === 0 ? (
        <Row label="No passkeys yet" hint="Add one to sign in without codes." />
      ) : (
        list.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            hint={`${p.synced ? "Synced passkey" : "On one device"}, added ${relTime(p.createdAt)}${p.lastUsedAt ? `, last used ${relTime(p.lastUsedAt)}` : ""}`}
          >
            <Button
              variant="quiet"
              size="compact"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Remove ${p.name}?`,
                  message: "You can still sign in with an emailed code.",
                  confirm: "Remove",
                  danger: true,
                });
                if (ok) run(() => accountApi.removePasskey(p.id)).then(load);
              }}
            >
              Remove
            </Button>
          </Row>
        ))
      )}
    </Group>
  );
}

function Devices() {
  const run = useAccount((s) => s.run);
  const [list, setList] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => accountApi.devices().then(setList, (e) => setError(errorMessage(e))), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Group title="Devices" note="Every PC signed in to your account. Removing one signs it out at once, including any open shared pages.">
      {error ? (
        <Row label="Not available right now" hint={error} />
      ) : !list ? (
        <Row label="Loading" />
      ) : (
        list.map((d) => (
          <Row key={d.id} label={d.name} hint={d.current ? "This PC" : `Last active ${relTime(d.lastSeenAt)}`}>
            {!d.current && (
              <Button
                variant="quiet"
                size="compact"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Sign out ${d.name}?`,
                    message: "That device is signed out right away and has to sign in again.",
                    confirm: "Sign Out Device",
                    danger: true,
                  });
                  if (ok) run(() => accountApi.revokeDevice(d.id), "Device signed out").then(load);
                }}
              >
                Sign Out
              </Button>
            )}
          </Row>
        ))
      )}
    </Group>
  );
}

function ServerGroup() {
  const view = useAccount((s) => s.view)!;
  const apply = useAccount((s) => s.apply);
  const run = useAccount((s) => s.run);
  const [url, setUrl] = useState(view.serverUrl ?? "");
  const locked = view.status !== "signed_out";
  return (
    <Group
      title="Server"
      note={locked ? "Sign out to use a different account server." : "Where accounts and Team workspaces live. Leave as it is unless you run your own."}
    >
      {locked ? (
        <Row label="Address" hint={<span className="isolate">{view.serverUrl}</span>} />
      ) : (
        <div className="acct-server">
          <input className="field" value={url} placeholder="https://" aria-label="Server address" onChange={(e) => setUrl(e.target.value)} />
          <Button
            variant="plain"
            size="compact"
            disabled={url.trim() === (view.serverUrl ?? "")}
            onClick={() => run(async () => apply(await accountApi.setServer(url.trim())), "Server saved")}
          >
            Save
          </Button>
        </div>
      )}
    </Group>
  );
}

/** Shown while the account is set to be deleted: one button keeps it. */
function PendingDeletion() {
  const [d, setD] = useState<Deletion | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    serviceApi.deletion().then(setD, () => undefined);
  }, []);
  if (!d?.dueAt) return null;
  return (
    <Notice icon="warning" tone="warning">
      <span>This account will be deleted on {new Date(d.dueAt).toLocaleDateString()}. Until then everything can come back as it was.</span>
      <div className="acct-notice-action">
        <Button
          variant="tinted"
          size="compact"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await serviceApi.cancelDeletion();
              setD({ ...d, dueAt: null });
              useStore.getState().toast({ message: "Your account is kept", tone: "success" });
            } catch (e) {
              useStore.getState().toast({ message: errorMessage(e), tone: "error" });
            }
            setBusy(false);
          }}
        >
          Cancel Deletion
        </Button>
      </div>
    </Notice>
  );
}

/** Ideas, problems, the help center and messages from the team. */
function HelpGroup({ signedIn }: { signedIn: boolean }) {
  const open = useServiceUi((s) => s.open);
  return (
    <Group title="Help and Feedback" note="Replies to problems come by email from support@enterworlds.space and to your notifications here.">
      <Row label="Suggest an idea" hint="Others can vote for it once it is on the board.">
        <Button variant="plain" size="compact" onClick={() => openFeedback("idea")}>
          Suggest
        </Button>
      </Row>
      <Row label="Report a problem" hint="With screenshots and, if you like, technical details.">
        <Button variant="plain" size="compact" onClick={() => openFeedback("problem")}>
          Send Report
        </Button>
      </Row>
      {signedIn && (
        <Row label="Messages from Worlds" hint="When the Worlds team writes to you.">
          <Button variant="plain" size="compact" onClick={() => open({ kind: "messages" })}>
            Open
          </Button>
        </Row>
      )}
      <Row label="Help center" hint="support.enterworlds.space">
        <Button variant="plain" size="compact" icon="openExternal" onClick={() => void openExternal(SUPPORT_URL)}>
          Open
        </Button>
      </Row>
      <Row label="Ideas and roadmap" hint="What people asked for, and what is coming.">
        <Button variant="plain" size="compact" icon="openExternal" onClick={() => void openExternal(`${SUPPORT_URL}/roadmap`)}>
          Open
        </Button>
      </Row>
    </Group>
  );
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? "is-on" : ""}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  );
}

/** Usage counts and the testers programme. */
function PrivacyGroup() {
  const usage = useStore((s) => s.settings["privacy.usageCounts"] === true);
  const [tester, setTester] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    serviceApi.testers().then(
      (t) => setTester(t.status),
      () => setTester(undefined),
    );
  }, []);
  const toggleTester = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) setTester((await serviceApi.applyTesters([appPlatform()])).status);
      else {
        await serviceApi.leaveTesters();
        setTester(null);
      }
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
    setBusy(false);
  };
  const testerHint =
    tester === "accepted" ? "You are a tester. Thank you." : tester === "applied" ? "Asked. The team answers soon." : tester === "declined" ? "Not this time." : "Try new versions before everyone else.";
  return (
    <Group title="Privacy and Testing" note="Counts are how many, never what: no titles, text or files. Testers get new versions first and a short question now and then.">
      <Row label="Send usage counts" hint="Once a day: pages, kinds of pages and features in use, version, language and theme.">
        <Switch on={usage} label="Send usage counts" onChange={setUsageCounts} />
      </Row>
      <Row label="Be a Worlds tester" hint={testerHint}>
        <Switch on={tester === "applied" || tester === "accepted"} label="Be a Worlds tester" disabled={busy || tester === undefined} onChange={toggleTester} />
      </Row>
    </Group>
  );
}

/** A copy of one's data, and deleting the account. */
function DataGroup() {
  const open = useServiceUi((s) => s.open);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    const name = `worlds-account-${new Date().toISOString().slice(0, 10)}.json`;
    setBusy(true);
    try {
      if (isWeb) {
        const data = await serviceApi.exportData();
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } else {
        const path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
        if (path) {
          await serviceApi.exportTo(path);
          useStore.getState().toast({ message: "Your data is saved", tone: "success" });
        }
      }
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
    setBusy(false);
  };
  return (
    <Group title="Your Data" note="The copy has what the account service keeps about you. Your pages are already on this PC.">
      <Row label="Download my data" hint="One JSON file: account, devices, workspaces, profile, published pages, requests.">
        <Button variant="plain" size="compact" loading={busy} onClick={download}>
          Download
        </Button>
      </Row>
      <Row label="Delete account" hint="30 days to change your mind. Pages on this PC are not touched.">
        <Button variant="danger" size="compact" onClick={() => open({ kind: "delete" })}>
          Delete Account
        </Button>
      </Row>
    </Group>
  );
}
