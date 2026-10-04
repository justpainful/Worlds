import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { Automation, HistoryEntry, Page, PageMeta, Version } from "../lib/types";
import { useStore } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Segmented } from "../ui/Segmented";
import { IconButton, Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Avatar, EmptyState, formatBytes, formatDateTime, relTime, Spinner } from "../ui/misc";
import { Modal } from "../ui/Modal";
import { describeTrigger, describeDestination } from "../lib/automationText";
import { BlocksPreview } from "./BlocksPreview";

export type InspectorPanel = "info" | "history" | "instructions";

export function Inspector({
  page,
  meta,
  panel,
  onPanel,
  onClose,
  onRestored,
  paneId,
}: {
  page: Page;
  meta: PageMeta;
  panel: InspectorPanel;
  onPanel: (p: InspectorPanel) => void;
  onClose: () => void;
  onRestored: () => void;
  paneId: string;
}) {
  const host = document.querySelector(`[data-pane="${paneId}"]`)?.parentElement;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host) return null;
  return createPortal(
    <Glass material="dense" layer={LAYER.floating} className="inspector" radius="var(--r-float)">
      <div className="inspector-head">
        <Segmented
          value={panel}
          onChange={onPanel}
          layer={LAYER.floating + 0.2}
          label="Inspector"
          options={[
            { value: "info", label: "Info" },
            { value: "history", label: "History" },
            { value: "instructions", label: "Assistant" },
          ]}
        />
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      <div className="inspector-body scroll">
        {panel === "info" && <InfoPanel page={page} meta={meta} />}
        {panel === "history" && <HistoryPanel page={page} onRestored={onRestored} />}
        {panel === "instructions" && <InstructionsPanel page={page} />}
      </div>
    </Glass>,
    host,
  );
}

function InfoPanel({ page, meta }: { page: Page; meta: PageMeta }) {
  const profile = useStore((s) => s.profile);
  const open = useStore((s) => s.open);
  const [autos, setAutos] = useState<Automation[] | null>(null);
  useEffect(() => {
    api.automations().then((a) => setAutos(a.filter((x) => x.spec.source?.pageId === page.id))).catch(() => setAutos([]));
  }, [page.id]);
  return (
    <div className="insp-stack">
      <div className="owner-card">
        <Avatar id={profile?.avatar} name={profile?.displayName} size={36} />
        <div>
          <div className="owner-name bidi">{profile?.displayName || "You"}</div>
          <div className="owner-role">
            <Icon name="owner" size={12} />
            Owner
          </div>
        </div>
        <span className="grow" />
        <span className="tag">
          <Icon name="lock" size={11} />
          Local
        </span>
      </div>

      <dl className="facts">
        <dt>Created</dt>
        <dd>{formatDateTime(meta.createdAt)}</dd>
        <dt>Edited</dt>
        <dd>{formatDateTime(meta.updatedAt)}</dd>
        <dt>Location</dt>
        <dd className="bidi">{page.breadcrumbs.length ? page.breadcrumbs.map((c) => c.title || "Untitled").join(" / ") : "Top level"}</dd>
        <dt>Blocks</dt>
        <dd>{page.blocks.length}</dd>
        <dt>Mentioned in</dt>
        <dd>{page.backlinks.length ? `${page.backlinks.length} page${page.backlinks.length === 1 ? "" : "s"}` : "Nowhere yet"}</dd>
      </dl>

      <div className="insp-section">
        <div className="insp-title">Attachments</div>
        {page.attachments.length === 0 ? (
          <EmptyState compact icon="attachment" title="No attachments" text="Drop files onto the page, or type /image or /file." />
        ) : (
          <div className="att-list">
            {page.attachments.filter((a) => !a.fileName.endsWith("-poster.jpg")).map((a) => (
              <div key={a.id} className="att-row">
                {a.kind === "image" || a.kind === "gif" ? <img src={fileUrl(a.id)} alt="" crossOrigin="anonymous" /> : <Icon name={a.kind === "video" ? "video" : "file"} size={16} />}
                <span className="att-name isolate" dir="auto">{a.fileName}</span>
                <span className="att-size">{formatBytes(a.size)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="insp-section">
        <div className="insp-title">Automations</div>
        {autos === null ? (
          <Spinner />
        ) : autos.length === 0 ? (
          <EmptyState compact icon="automation" title="No automations" text="Schedule this page to be sent to Discord." />
        ) : (
          autos.map((a) => (
            <button key={a.id} className="auto-row" onClick={() => open({ kind: "automations", automationId: a.id }, "right")}>
              <Icon name="schedule" size={15} />
              <span className="auto-row-main">
                <span className="bidi">{a.name}</span>
                <span className="auto-row-sub">{describeTrigger(a.spec.trigger)} · <bdi>{describeDestination(a.spec.destination)}</bdi></span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

interface Group {
  key: string;
  actor: string;
  opId: string | null;
  entries: HistoryEntry[];
  at: number;
  undone: boolean;
}

function groupHistory(list: HistoryEntry[]): Group[] {
  const groups: Group[] = [];
  for (const h of list) {
    const last = groups[groups.length - 1];
    if (h.opId && last && last.opId === h.opId) {
      last.entries.push(h);
      continue;
    }
    groups.push({ key: `${h.id}`, actor: h.actor, opId: h.opId, entries: [h], at: h.createdAt, undone: !!h.meta?.undone });
  }
  return groups;
}

function HistoryPanel({ page, onRestored }: { page: Page; onRestored: () => void }) {
  const profile = useStore((s) => s.profile);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [review, setReview] = useState<Group | null>(null);
  const [preview, setPreview] = useState<Version | null>(null);
  const load = () => {
    api.history(page.id, null, 200).then(setHistory).catch(() => setHistory([]));
    api.versions(page.id).then(setVersions).catch(() => setVersions([]));
  };
  useEffect(load, [page.id]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("worlds:changed", h);
    return () => window.removeEventListener("worlds:changed", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const groups = useMemo(() => groupHistory(history ?? []), [history]);

  const undo = async (g: Group) => {
    if (!g.opId) return;
    try {
      await api.undoOp(g.opId);
      useStore.getState().toast({ message: "Changes undone", tone: "success" });
      onRestored();
      load();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };

  const restore = async (v: Version) => {
    try {
      await api.restoreVersion(v.id);
      useStore.getState().toast({ message: "Version restored. The previous state was kept as a version too.", tone: "success" });
      setPreview(null);
      onRestored();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };

  if (!history || !versions) return <Spinner />;
  return (
    <div className="insp-stack">
      <div className="insp-section">
        <div className="insp-title">Changes</div>
        {groups.length === 0 ? (
          <EmptyState compact icon="history" title="No history" text="Changes to this page will be listed here." />
        ) : (
          <ol className="timeline">
            {groups.map((g) => {
              const isOp = g.actor === "ai" || g.actor === "automation";
              const blocks = g.entries.filter((e) => e.kind.startsWith("block_")).length;
              const who = g.actor === "ai" ? "Claude" : g.actor === "automation" ? "Automation" : profile?.displayName || "You";
              const title = isOp && blocks > 0 ? `${who} changed ${blocks} block${blocks === 1 ? "" : "s"}` : g.entries[0].summary;
              return (
                <li key={g.key} className={`tl-item tl-${g.actor} ${g.undone ? "is-undone" : ""}`}>
                  <span className="tl-dot">
                    <Icon name={g.actor === "ai" ? "assistant" : g.actor === "automation" ? "automation" : g.entries[0].kind === "discord_sent" ? "discord" : "edit"} size={12} />
                  </span>
                  <div className="tl-main">
                    <div className="tl-title bidi">{title}</div>
                    <div className="tl-sub">
                      {who} · {relTime(g.at)}
                      {g.undone && " · Undone"}
                    </div>
                    {isOp && g.opId && blocks > 0 && (
                      <div className="tl-actions">
                        <button className="chip-btn" onClick={() => setReview(g)}>Review changes</button>
                        {!g.undone && (
                          <button className="chip-btn" onClick={() => undo(g)}>
                            <Icon name="undo" size={12} />
                            Undo
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="insp-section">
        <div className="insp-title">Versions</div>
        {versions.length === 0 ? (
          <EmptyState compact icon="restore" title="No versions yet" text="A version is kept before each editing session and before every change Claude makes." />
        ) : (
          <div className="versions">
            {versions.map((v) => (
              <div key={v.id} className="version-row">
                <div className="version-main">
                  <div className="version-title">{v.label || formatDateTime(v.createdAt)}</div>
                  <div className="version-sub">
                    {v.label ? `${formatDateTime(v.createdAt)} · ` : ""}
                    {v.blockCount} block{v.blockCount === 1 ? "" : "s"}
                  </div>
                </div>
                <button className="chip-btn" onClick={() => setPreview(v)}>Preview</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {review && <ReviewModal group={review} onClose={() => setReview(null)} onUndo={() => { undo(review); setReview(null); }} />}
      {preview && <VersionModal version={preview} onClose={() => setPreview(null)} onRestore={() => restore(preview)} />}
    </div>
  );
}

function ReviewModal({ group, onClose, onUndo }: { group: Group; onClose: () => void; onUndo: () => void }) {
  const changes = group.entries.filter((e) => e.kind.startsWith("block_")).reverse();
  return (
    <Modal
      title={group.actor === "ai" ? "Changes by Claude" : "Changes by automation"}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Close</Button>
          {!group.undone && <Button variant="tinted" icon="undo" onClick={onUndo}>Undo all</Button>}
        </>
      }
    >
      <div className="review-list">
        {changes.map((c) => (
          <div key={c.id} className={`review-item review-${c.kind}`}>
            <div className="review-kind">{c.kind === "block_added" ? "Added" : c.kind === "block_removed" ? "Removed" : "Changed"}</div>
            <div className="review-cols">
              {c.before && (
                <div className="review-col is-before">
                  <BlocksPreview blocks={[c.before as JSONContent]} />
                </div>
              )}
              {c.after && (
                <div className="review-col is-after">
                  <BlocksPreview blocks={[c.after as JSONContent]} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function VersionModal({ version, onClose, onRestore }: { version: Version; onClose: () => void; onRestore: () => void }) {
  const [snap, setSnap] = useState<{ title: string; blocks: JSONContent[] } | null>(null);
  useEffect(() => {
    api.version(version.id).then(setSnap).catch(() => setSnap({ title: "", blocks: [] }));
  }, [version.id]);
  return (
    <Modal
      title={version.label || formatDateTime(version.createdAt)}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Close</Button>
          <Button variant="tinted" icon="restore" onClick={onRestore}>Restore this version</Button>
        </>
      }
    >
      {!snap ? (
        <Spinner />
      ) : (
        <div className="version-preview">
          <h1 className="vp-title bidi">{snap.title || "Untitled"}</h1>
          {snap.blocks.length ? <BlocksPreview blocks={snap.blocks} /> : <EmptyState compact icon="page" title="Empty page" />}
        </div>
      )}
    </Modal>
  );
}

function InstructionsPanel({ page }: { page: Page }) {
  const meta = useStore((s) => s.pages[page.id]);
  const open = useStore((s) => s.open);
  const [items, setItems] = useState<string[]>(page.instructions.length ? page.instructions : []);
  const [draft, setDraft] = useState("");
  const save = async (next: string[]) => {
    setItems(next);
    try {
      await api.updatePage(page.id, { instructions: next.filter((s) => s.trim()) });
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  void meta;
  return (
    <div className="insp-stack">
      <p className="insp-note">
        Private rules Claude follows when working on this page. They are never part of the page’s content and never sent anywhere.
      </p>
      {items.length === 0 && <EmptyState compact icon="instructions" title="No instructions" text="For example: “Use Saudi Arabic.” or “Never alter the Previous Decisions section.”" />}
      <ul className="instr-list">
        {items.map((it, i) => (
          <li key={i} className="instr-item">
            <textarea
              dir="auto"
              className="instr-input bidi"
              value={it}
              rows={1}
              onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
              onBlur={() => save(items)}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "0px";
                el.style.height = `${el.scrollHeight}px`;
              }}
            />
            <IconButton icon="close" label="Remove" onClick={() => save(items.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <div className="instr-add">
        <input
          dir="auto"
          className="field bidi"
          placeholder="Add an instruction"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              save([...items, draft.trim()]);
              setDraft("");
            }
          }}
        />
      </div>
      <button className="link-btn" onClick={() => open({ kind: "settings", section: "ai" }, "tab")}>
        Global instructions apply to every page · Edit in Settings
      </button>
    </div>
  );
}
