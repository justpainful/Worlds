import { useCallback, useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { formatDateTime } from "../../ui/misc";
import { useStore } from "../../state/store";
import { syncConfig } from "../config";
import type { CollabSession } from "../session";
import { listVersions, restoreInto, saveVersion, versionState, type SharedVersion, type VersionApi } from "../versions";
import { useComments } from "./hooks";

/** Shared history of a page, with who contributed to each version. */
export function VersionsSheet({ session, onClose }: { session: CollabSession; onClose: () => void }) {
  const { people } = useComments(session);
  const [versions, setVersions] = useState<SharedVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cfg = syncConfig();
  const server = cfg.serverUrl();
  const api: VersionApi | null = server ? { serverUrl: server, getToken: () => cfg.getToken(), workspaceId: session.workspaceId, docId: session.pageId } : null;

  const load = useCallback(() => {
    if (!api) return setError("Connect to a sync server to see shared history.");
    listVersions(api)
      .then((v) => {
        setVersions(v);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [session.pageId, server]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);

  const name = (id: string) => (id === session.user.id ? "You" : (people.find((p) => p.id === id)?.name ?? "Someone"));

  const restore = async (v: SharedVersion) => {
    if (!api) return;
    setBusy(v.id);
    try {
      await saveVersion(api, "Before restore").catch(() => undefined);
      restoreInto(session.content, await versionState(api, v.id));
      useStore.getState().toast({ message: "Restored. Everyone on the page sees it now." });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Shared History"
      onClose={onClose}
      width={520}
      footer={
        session.canEdit && api ? (
          <Button
            variant="plain"
            loading={busy === "save"}
            onClick={async () => {
              setBusy("save");
              await saveVersion(api, null).catch((e) => setError(String(e)));
              setBusy(null);
              load();
            }}
          >
            Save Version Now
          </Button>
        ) : undefined
      }
    >
      <div className="versions-list">
        {error && <p className="ss-error">{error}</p>}
        {!error && versions === null && <p className="ss-note">Loading</p>}
        {versions?.length === 0 && <p className="ss-note">Versions appear as people edit this page.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="version-row">
            <div className="version-text">
              <strong>{v.label || formatDateTime(v.createdAt)}</strong>
              <span>
                {v.label ? `${formatDateTime(v.createdAt)}, ` : ""}
                {v.authors.length ? v.authors.map(name).join(", ") : "No edits"}
              </span>
            </div>
            {session.canEdit && (
              <Button size="compact" variant="plain" loading={busy === v.id} onClick={() => void restore(v)}>
                Restore
              </Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
