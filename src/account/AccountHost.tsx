import { useEffect, useState } from "react";
import { errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { accountApi, ROLE_LABEL, type InvitePreview } from "./api";
import { useAccount } from "./store";
import { SignInFlow } from "./SignIn";
import { Onboarding } from "./Onboarding";
import { MembersSheet } from "./MembersSheet";
import { ShareSheet } from "./ShareSheet";
import { Notice } from "./parts";

/** Renders whichever account sheet is open, plus first-run onboarding. */
export function AccountHost() {
  const sheet = useAccount((s) => s.sheet);
  const close = useAccount((s) => s.close);
  const view = useAccount((s) => s.view);
  const onboarded = useStore((s) => !!s.settings["account.onboarded"]);
  // Decided once, from the first account state: signing in during onboarding keeps it open for its last step.
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  useEffect(() => {
    if (firstRun === null && view) setFirstRun(!onboarded && view.status === "signed_out");
  }, [view, onboarded, firstRun]);

  if (firstRun && !onboarded) return <Onboarding />;
  if (!sheet) return null;
  switch (sheet.kind) {
    case "signin":
      return (
        <Modal onClose={close} width={420} bare className="acct-modal">
          <SignInFlow start={sheet.start} onDone={close} onCancel={close} />
        </Modal>
      );
    case "create":
      return <CreateWorkspace />;
    case "join":
      return <JoinWorkspace initial={sheet.link} />;
    case "members":
      return <MembersSheet workspaceId={sheet.workspaceId} />;
    case "share":
      return <ShareSheet pageId={sheet.pageId} />;
  }
}

function CreateWorkspace() {
  const close = useAccount((s) => s.close);
  const apply = useAccount((s) => s.apply);
  const open = useAccount((s) => s.open);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await accountApi.createWorkspace(name.trim());
      apply(v);
      useStore.getState().toast({ message: `${name.trim()} is ready. New pages you add now are shared with it.`, tone: "success" });
      if (v.activeWorkspaceId) open({ kind: "members", workspaceId: v.activeWorkspaceId });
      else close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New Team Workspace"
      onClose={close}
      width={420}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button variant="tinted" loading={busy} disabled={!name.trim()} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <p className="acct-text is-left">A shared place for pages you work on with other people. You will be its owner, and you can invite people next.</p>
      <input
        className="field"
        autoFocus
        placeholder="Workspace name"
        aria-label="Workspace name"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && create()}
      />
      {error && <p className="acct-error is-left">{error}</p>}
    </Modal>
  );
}

function JoinWorkspace({ initial }: { initial?: string }) {
  const close = useAccount((s) => s.close);
  const apply = useAccount((s) => s.apply);
  const view = useAccount((s) => s.view);
  const [link, setLink] = useState(initial ?? "");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = view?.status === "active";

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

  if (!signedIn) {
    return (
      <Modal onClose={close} width={420} bare className="acct-modal">
        <SignInFlow onDone={() => useAccount.getState().open({ kind: "join", link })} onCancel={close} />
      </Modal>
    );
  }

  const check = () => act(async () => setPreview(await accountApi.invitePreview(link)));
  const join = () =>
    act(async () => {
      const v = await accountApi.join(link);
      apply(v);
      useStore.getState().toast({ message: `You joined ${preview?.workspace?.name ?? "the workspace"}.`, tone: "success" });
      close();
    });

  return (
    <Modal
      title="Join a Workspace"
      onClose={close}
      width={440}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          {preview?.valid ? (
            <Button variant="tinted" loading={busy} onClick={join}>
              Join {preview.workspace?.name}
            </Button>
          ) : (
            <Button variant="tinted" loading={busy} disabled={!link.trim()} onClick={check}>
              Continue
            </Button>
          )}
        </>
      }
    >
      <p className="acct-text is-left">Paste the invite link someone sent you.</p>
      <input
        className="field"
        autoFocus
        placeholder="Invite link"
        aria-label="Invite link"
        value={link}
        onChange={(e) => {
          setLink(e.target.value);
          setPreview(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && link.trim() && (preview?.valid ? join() : check())}
      />
      {preview && !preview.valid && (
        <Notice icon="warning" tone="warning">
          {preview.message ?? "This invite link does not work."}
        </Notice>
      )}
      {preview?.valid && (
        <Notice icon="users">
          You are invited to <strong className="bidi">{preview.workspace?.name}</strong> as{" "}
          {preview.role ? `a ${ROLE_LABEL[preview.role].toLowerCase()}` : "a member"}.
        </Notice>
      )}
      {error && <p className="acct-error is-left">{error}</p>}
    </Modal>
  );
}
