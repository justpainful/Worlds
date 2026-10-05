import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { HistoryEntry, PageMeta, ResourceKind } from "../../lib/types";
import { childrenOf, pageTitle, useStore } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Popover } from "../../ui/Menu";
import { EmptyState, PageIcon, relTime, Spinner } from "../../ui/misc";
import { SearchField } from "../../ui/SearchField";
import { Select } from "../../ui/Select";
import { newResourceMenu } from "../create";
import { KIND_INFO, isResource } from "../kinds";
import { ResourceHeader, saveMeta, useResource } from "./ResourceHeader";

interface ProjectMeta {
  status: "planned" | "active" | "paused" | "done";
  start: string | null;
  due: string | null;
  description: string;
  links: string[];
}

const STATUS: { value: ProjectMeta["status"]; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];

const ORDER: ResourceKind[] = ["document", "presentation", "page", "gallery", "file", "stream", "project"];

/**
 * A project gathers resources: the ones that live in it (its children) and
 * ones linked from elsewhere, which keep their place and identity.
 */
export function ProjectView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const { page, error } = useResource(id);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [linkPick, setLinkPick] = useState<DOMRect | null>(null);
  const [activity, setActivity] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!page) return;
    const p = (page.metadata as { project?: Partial<ProjectMeta> }).project ?? {};
    setProject({ status: p.status ?? "active", start: p.start ?? null, due: p.due ?? null, description: p.description ?? "", links: p.links ?? [] });
  }, [page]);

  const inside = useMemo(() => childrenOf(pages, id), [pages, id]);
  const linked = useMemo(() => (project?.links ?? []).map((l) => pages[l]).filter((p): p is PageMeta => !!p && !p.deletedAt), [project, pages]);

  // Recent activity across the project and everything in it.
  useEffect(() => {
    const ids = [id, ...inside.map((p) => p.id)].slice(0, 30);
    Promise.all(ids.map((pid) => api.history(pid, null, 8).catch(() => [] as HistoryEntry[]))).then((lists) =>
      setActivity(lists.flat().filter((h) => h.pageId && ids.includes(h.pageId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)),
    );
  }, [id, inside]);

  if (error) return <EmptyState icon="warning" title="This project could not be opened" text={error} />;
  if (!page || !meta || !project) return <div className="page-loading"><Spinner /></div>;

  const update = (patch: Partial<ProjectMeta>) => {
    const next = { ...project, ...patch };
    setProject(next);
    saveMeta(id, "project", next);
  };
  const groups = ORDER.map((k) => ({ kind: k, items: inside.filter((p) => p.kind === k) })).filter((g) => g.items.length);

  return (
    <div className="res-view res-project">
      <ResourceHeader
        meta={meta}
        subtitle={<span className={`proj-status is-${project.status}`}>{STATUS.find((s) => s.value === project.status)?.label}</span>}
        actions={<Button variant="tinted" icon="add" onClick={(e) => newResourceMenu(e.currentTarget, { parentId: id, align: "end" })}>New</Button>}
      />

      <section className="res-card proj-overview">
        <div className="proj-fields">
          <label>
            <span className="field-label">Status</span>
            <Select value={project.status} options={STATUS} onChange={(v) => update({ status: v as ProjectMeta["status"] })} />
          </label>
          <label>
            <span className="field-label">Start</span>
            <input className="field" type="date" value={project.start ?? ""} onChange={(e) => update({ start: e.target.value || null })} />
          </label>
          <label>
            <span className="field-label">Due</span>
            <input className="field" type="date" value={project.due ?? ""} onChange={(e) => update({ due: e.target.value || null })} />
          </label>
        </div>
        <textarea
          className="field proj-desc bidi"
          dir="auto"
          placeholder="What is this project about?"
          defaultValue={project.description}
          key={page.updatedAt}
          onBlur={(e) => e.target.value !== project.description && update({ description: e.target.value })}
        />
      </section>

      {groups.length === 0 && linked.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nothing here yet"
          text="Create documents, presentations, galleries or pages inside this project, upload files, or link things that live elsewhere."
          action={<Button variant="tinted" icon="add" onClick={(e) => newResourceMenu(e.currentTarget, { parentId: id })}>New</Button>}
        />
      ) : (
        groups.map((g) => (
          <section key={g.kind} className="proj-group">
            <h2 className="proj-group-title">{KIND_INFO[g.kind].plural}</h2>
            <div className="proj-items">
              {g.items.map((p) => (
                <ResourceCard key={p.id} p={p} onOpen={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")} />
              ))}
            </div>
          </section>
        ))
      )}

      <section className="proj-group">
        <div className="proj-group-head">
          <h2 className="proj-group-title">Linked</h2>
          <Button variant="quiet" icon="link" onClick={(e) => setLinkPick(e.currentTarget.getBoundingClientRect())}>Link existing</Button>
        </div>
        {linked.length ? (
          <div className="proj-items">
            {linked.map((p) => (
              <ResourceCard
                key={p.id}
                p={p}
                onOpen={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
                onUnlink={() => update({ links: project.links.filter((l) => l !== p.id) })}
              />
            ))}
          </div>
        ) : (
          <p className="proj-hint">Linked resources stay where they are; the project just points to them.</p>
        )}
      </section>

      {activity.length > 0 && (
        <section className="proj-group">
          <h2 className="proj-group-title">Activity</h2>
          <ul className="proj-activity">
            {activity.map((h) => (
              <li key={h.id}>
                <span className="bidi">{h.pageTitle || "Untitled"}</span>
                <span className="proj-act-sum">{h.summary}</span>
                <span className="proj-act-when">{h.actor === "ai" ? "Claude · " : ""}{relTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {linkPick && (
        <LinkPicker
          anchor={linkPick}
          exclude={new Set([id, ...project.links, ...inside.map((p) => p.id)])}
          onPick={(pid) => {
            update({ links: [...project.links, pid] });
            setLinkPick(null);
          }}
          onClose={() => setLinkPick(null)}
        />
      )}
    </div>
  );
}

function ResourceCard({ p, onOpen, onUnlink }: { p: PageMeta; onOpen: (e: React.MouseEvent) => void; onUnlink?: () => void }) {
  const kind = p.kind === "template" ? "page" : p.kind;
  return (
    <div className="proj-card">
      <button className="proj-card-main" onClick={onOpen}>
        <PageIcon icon={p.icon ?? `pi:${KIND_INFO[kind].icon}`} size={26} />
        <span className="proj-card-text">
          <span className="proj-card-title bidi">{pageTitle(p)}</span>
          <span className="proj-card-sub">{KIND_INFO[kind].label} · {relTime(p.updatedAt)}</span>
        </span>
      </button>
      {onUnlink && <IconButton icon="close" label="Unlink" className="proj-unlink" onClick={onUnlink} />}
    </div>
  );
}

function LinkPicker({ anchor, exclude, onPick, onClose }: { anchor: DOMRect; exclude: Set<string>; onPick: (id: string) => void; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const [q, setQ] = useState("");
  const list = Object.values(pages)
    .filter((p) => isResource(p) && !p.deletedAt && !exclude.has(p.id) && (!q.trim() || pageTitle(p).toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40);
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} align="end">
      <div className="link-pick">
        <SearchField value={q} onChange={setQ} placeholder="Find something to link" autoFocus />
        <div className="link-pick-list">
          {list.map((p) => (
            <button key={p.id} className="menu-item" onClick={() => onPick(p.id)}>
              <span className="menu-icon"><PageIcon icon={p.icon} size={16} /></span>
              <span className="menu-text bidi">{pageTitle(p)}</span>
              <span className="menu-shortcut">{KIND_INFO[p.kind === "template" ? "page" : p.kind].label}</span>
            </button>
          ))}
          {list.length === 0 && <p className="proj-hint">Nothing matches.</p>}
        </div>
      </div>
    </Popover>
  );
}
