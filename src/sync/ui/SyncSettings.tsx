import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { useStore } from "../../state/store";
import { tokenSubject } from "../config";
import { announceModeChange, localStore } from "../session";
import type { PageMode } from "../localStore";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Live sync for testing, until accounts and Team workspaces land: the sync
 * service address, an access token, and a switch that shares this page.
 */
export function SyncSettings({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [server, setServer] = useState(str(settings["sync.serverUrl"]));
  const [token, setToken] = useState(str(settings["sync.devToken"]));
  const [workspace, setWorkspace] = useState(str(settings["sync.workspaceId"]) || "default");
  const [mode, setMode] = useState<PageMode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStore()
      .pageMode(pageId)
      .then(setMode)
      .catch(() => setMode(null));
  }, [pageId]);

  const serverOk = !server || /^https?:\/\/[^\s]+$/.test(server.trim());
  const who = tokenSubject(token.trim());

  const persist = () => {
    setSetting("sync.serverUrl", server.trim());
    setSetting("sync.devToken", token.trim());
    setSetting("sync.workspaceId", workspace.trim() || "default");
  };
  const save = () => {
    persist();
    onClose();
  };

  const toggleShare = async () => {
    if (!mode || !serverOk) return;
    setBusy(true);
    try {
      // The page reopens in its new mode: keep what was typed here.
      persist();
      setMode(await localStore().setShared(pageId, !mode.flagged));
      announceModeChange(pageId);
    } catch (e) {
      useStore.getState().toast({ message: `Could not change sharing: ${e instanceof Error ? e.message : String(e)}`, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Live Sync"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="tinted" disabled={!serverOk} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="sync-settings">
        <p className="ss-note">For testing between two computers before shared workspaces arrive. Pages stay on this computer and keep working offline.</p>
        <label className="ss-field">
          <span>Sync server</span>
          <input className="field" value={server} placeholder="http://localhost:8790" spellCheck={false} onChange={(e) => setServer(e.target.value)} />
          {!serverOk && <em className="ss-error">Enter a full http or https address.</em>}
        </label>
        <label className="ss-field">
          <span>Access token</span>
          <input className="field" type="password" value={token} placeholder="Issued by the identity service" spellCheck={false} onChange={(e) => setToken(e.target.value)} />
          {token && <em className="ss-hint">{who ? `Signs in as ${who}` : "This does not look like an access token."}</em>}
        </label>
        <label className="ss-field">
          <span>Workspace</span>
          <input className="field" value={workspace} spellCheck={false} onChange={(e) => setWorkspace(e.target.value)} />
        </label>
        {mode && (
          <div className="ss-share">
            <div>
              <strong>{mode.workspaceId ? "This page is in a shared workspace" : mode.flagged ? "This page is shared" : "This page is personal"}</strong>
              <span>{mode.workspaceId ? "Everyone in the workspace edits it live." : "Shared pages sync live and work offline."}</span>
            </div>
            {!mode.workspaceId && (
              <Button variant={mode.flagged ? "plain" : "tinted"} size="compact" loading={busy} onClick={toggleShare}>
                {mode.flagged ? "Stop Sharing" : "Share Page"}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
