import { useMemo, useState, type DragEvent } from "react";
import { SearchField } from "../../ui/SearchField";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { api, errorMessage, fileUrl } from "../../lib/api";
import type { PageMeta } from "../../lib/types";
import { useStore, childrenOf, pageTitle } from "../../state/store";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { PageIcon, relTime } from "../../ui/misc";
import { promptText } from "../prompt";
import {
  newProperty,
  nextColor,
  optionColor,
  propByName,
  propsOf,
  propText,
  STATUS_OPTIONS,
  type Property,
} from "../../pages/properties";
import { isResource } from "../../resources/kinds";

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export function ToggleView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const open = node.attrs.open !== false;
  return (
    <NodeViewWrapper className={`toggle ${open ? "is-open" : ""}`}>
      <button
        className="toggle-chevron"
        contentEditable={false}
        aria-label={open ? "Collapse" : "Expand"}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.isEditable && updateAttributes({ open: !open })}
      >
        <Icon name="forward" size={14} />
      </button>
      <NodeViewContent className="toggle-body" />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

type View = "table" | "board" | "gallery" | "list";
const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: "table", label: "Table", icon: "table" },
  { id: "board", label: "Board", icon: "splitVertical" },
  { id: "gallery", label: "Gallery", icon: "grid" },
  { id: "list", label: "List", icon: "listView" },
];

const toast = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

/** Set one property on a page, creating it (with the collection's options) when missing. */
async function setProp(page: PageMeta, template: Property | undefined, name: string, value: Property["value"]) {
  const props = propsOf(page).map((p) => ({ ...p }));
  let p = props.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    p = template ? { ...template, id: `p${Math.random().toString(36).slice(2, 9)}`, value: null } : newProperty(name === "Status" ? "status" : "select", name);
    props.push(p);
  }
  p.value = value;
  if ((p.type === "select" || p.type === "status") && typeof value === "string" && value && !p.options?.some((o) => o.name === value)) {
    p.options = [...(p.options ?? []), { name: value, color: nextColor(p.options?.length ?? 0) }];
  }
  try {
    const meta = await api.setPageMeta(page.id, "properties", props);
    useStore.getState().patchPageLocal(meta);
  } catch (e) {
    toast(e);
  }
}

function Chip({ prop, value }: { prop: Property | undefined; value: string }) {
  return (
    <span className="prop-chip" style={{ ["--chip" as string]: optionColor(prop, value) }}>
      {value}
    </span>
  );
}

function PropValue({ prop }: { prop: Property | undefined }) {
  if (!prop || prop.value === null || prop.value === "" || (Array.isArray(prop.value) && !prop.value.length)) return <span className="cell-empty" />;
  if (prop.type === "status" || prop.type === "select") return <Chip prop={prop} value={String(prop.value)} />;
  if (prop.type === "tags" && Array.isArray(prop.value))
    return (
      <span className="chip-row">
        {prop.value.map((v) => (
          <Chip key={v} prop={prop} value={v} />
        ))}
      </span>
    );
  if (prop.type === "checkbox") return <span className={`cell-check ${prop.value ? "is-on" : ""}`}>{prop.value ? <Icon name="check" size={12} /> : null}</span>;
  if (prop.type === "url")
    return (
      <span className="cell-url isolate" dir="ltr">
        {String(prop.value).replace(/^https?:\/\//, "")}
      </span>
    );
  return <span className="bidi">{propText(prop)}</span>;
}

export function CollectionView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const a = node.attrs as {
    title: string;
    source: "children" | "tag" | "all";
    tag: string;
    view: View;
    groupBy: string;
    sortBy: string;
    sortDir: "asc" | "desc";
    filter: string;
    columns: string[] | null;
  };
  const pageId = (editor.storage as unknown as { worlds?: { pageId: string } }).worlds?.pageId ?? "";
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const editable = editor.isEditable;

  const rows = useMemo(() => {
    let list: PageMeta[];
    if (a.source === "children") list = childrenOf(pages, pageId, { archived: false });
    else
      list = Object.values(pages).filter(
        (p) =>
          !p.deletedAt &&
          !p.archived &&
          isResource(p) &&
          p.id !== pageId &&
          (a.source === "all" || (a.tag && (propsOf(p).some((x) => Array.isArray(x.value) && x.value.some((v) => v.toLowerCase() === a.tag.toLowerCase())) || false))),
      );
    const q = a.filter.trim().toLowerCase();
    if (q) list = list.filter((p) => `${pageTitle(p)} ${propsOf(p).map(propText).join(" ")}`.toLowerCase().includes(q));
    const dir = a.sortDir === "asc" ? 1 : -1;
    const key = (p: PageMeta): string | number =>
      a.sortBy === "updated" ? p.updatedAt : a.sortBy === "created" ? p.createdAt : a.sortBy === "title" ? pageTitle(p).toLowerCase() : propText(propByName(p, a.sortBy)).toLowerCase();
    return [...list].sort((x, y) => (key(x) > key(y) ? dir : key(x) < key(y) ? -dir : 0));
  }, [pages, pageId, a.source, a.tag, a.filter, a.sortBy, a.sortDir]);

  // Property columns: the union of names across rows, in first-seen order.
  const propNames = useMemo(() => {
    const seen: string[] = [];
    for (const p of rows) for (const x of propsOf(p)) if (!seen.includes(x.name)) seen.push(x.name);
    return seen;
  }, [rows]);
  const template = (name: string) => {
    for (const p of rows) {
      const hit = propByName(p, name);
      if (hit) return hit;
    }
    return undefined;
  };

  const groupProp = template(a.groupBy);
  const groups = useMemo(() => {
    const opts = groupProp?.options?.map((o) => o.name) ?? (a.groupBy === "Status" ? STATUS_OPTIONS.map((o) => o.name) : []);
    const names = [...opts];
    for (const p of rows) {
      const v = propText(propByName(p, a.groupBy));
      if (v && !names.includes(v)) names.push(v);
    }
    return ["", ...names];
  }, [rows, groupProp, a.groupBy]);

  const createRow = async (preset?: { name: string; value: string }) => {
    try {
      const meta = await api.createPage({ title: "", parentId: a.source === "children" ? pageId : null });
      useStore.getState().patchPageLocal(meta);
      if (preset?.value) await setProp(meta, template(preset.name), preset.name, preset.value);
      else if (a.source === "tag" && a.tag) {
        const t = template("Tags");
        await setProp(meta, t ?? { ...newProperty("tags", "Tags") }, t?.name ?? "Tags", [a.tag]);
      }
      openPage(meta.id, "right");
    } catch (e) {
      toast(e);
    }
  };

  const valueMenu = (el: HTMLElement, page: PageMeta, name: string) => {
    const t = template(name);
    const options = t?.options?.map((o) => o.name) ?? (name === "Status" ? STATUS_OPTIONS.map((o) => o.name) : []);
    menuAt(el, [
      ...options.map((o) => ({ label: o, checked: propText(propByName(page, name)) === o, onSelect: () => setProp(page, t, name, o) })),
      { kind: "separator" as const },
      { label: "Clear", icon: "close" as const, onSelect: () => setProp(page, t, name, null) },
    ]);
  };

  const sortMenu = (el: HTMLElement) =>
    menuAt(el, [
      { kind: "label", label: "Sort by" },
      ...["updated", "created", "title", ...propNames].map((k) => ({
        label: k === "updated" ? "Last edited" : k === "created" ? "Created" : k === "title" ? "Name" : k,
        checked: a.sortBy === k,
        onSelect: () => updateAttributes({ sortBy: k }),
      })),
      { kind: "separator" },
      { label: "Ascending", checked: a.sortDir === "asc", onSelect: () => updateAttributes({ sortDir: "asc" }) },
      { label: "Descending", checked: a.sortDir === "desc", onSelect: () => updateAttributes({ sortDir: "desc" }) },
    ]);

  const sourceMenu = (el: HTMLElement) =>
    menuAt(el, [
      { label: "Subpages of this page", checked: a.source === "children", onSelect: () => updateAttributes({ source: "children" }) },
      { label: "All pages", checked: a.source === "all", onSelect: () => updateAttributes({ source: "all" }) },
      {
        label: a.tag ? `Pages tagged "${a.tag}"` : "Pages with a tag",
        checked: a.source === "tag",
        onSelect: async () => {
          const t = await promptText({ title: "Show pages with this tag", initial: a.tag || "", placeholder: "Tag name", confirm: "Show" });
          if (t !== null) updateAttributes({ source: "tag", tag: t.trim() });
        },
      },
      ...(a.view === "board"
        ? [
            { kind: "separator" as const },
            { kind: "label" as const, label: "Group board by" },
            ...Array.from(new Set(["Status", ...propNames])).map((n) => ({ label: n, checked: a.groupBy === n, onSelect: () => updateAttributes({ groupBy: n }) })),
          ]
        : []),
    ]);

  const open = (e: React.MouseEvent, id: string) => openPage(id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current");

  const cover = (p: PageMeta) => (p.cover ? fileUrl(p.cover) : null);

  return (
    <NodeViewWrapper className={`collection ${selected ? "is-selected" : ""}`} contentEditable={false} data-drag-handle>
      <div className="col-head">
        <input
          className="col-title bidi"
          dir="auto"
          value={a.title}
          placeholder={a.source === "children" ? "Subpages" : a.source === "tag" ? `#${a.tag || "tag"}` : "All pages"}
          readOnly={!editable}
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
        <div className="col-views" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={a.view === v.id} className={`col-view ${a.view === v.id ? "is-on" : ""}`} onClick={() => updateAttributes({ view: v.id })} data-tip={v.label}>
              <Icon name={v.icon} size={15} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <SearchField size="compact" className="col-filter" placeholder="Filter" value={a.filter} onChange={(v) => updateAttributes({ filter: v })} />
        <button className="col-btn" onClick={(e) => sortMenu(e.currentTarget)} data-tip="Sort">
          <Icon name="sliders" size={15} />
        </button>
        <button className="col-btn" onClick={(e) => sourceMenu(e.currentTarget)} data-tip="Source">
          <Icon name="layers" size={15} />
        </button>
        {editable && (
          <button className="col-new" onClick={() => createRow(a.view === "board" ? undefined : undefined)}>
            <Icon name="add" size={14} />
            New
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="col-empty">
          {a.source === "children" ? "No subpages yet. New adds one here, with its own properties." : a.source === "tag" ? "No pages carry this tag yet." : "No pages."}
        </div>
      )}

      {rows.length > 0 && a.view === "table" && (
        <div className="col-table-wrap">
          <table className="col-table">
            <thead>
              <tr>
                <th>Name</th>
                {propNames.map((n) => (
                  <th key={n} className="bidi">
                    {n}
                  </th>
                ))}
                <th>Edited</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="col-name" onClick={(e) => open(e, p.id)}>
                      <PageIcon icon={p.icon} size={17} />
                      <span className="bidi">{pageTitle(p)}</span>
                    </button>
                  </td>
                  {propNames.map((n) => {
                    const prop = propByName(p, n);
                    const t = prop ?? template(n);
                    const choosable = t && (t.type === "status" || t.type === "select");
                    return (
                      <td key={n}>
                        {t?.type === "checkbox" ? (
                          <button className="col-cell" onClick={() => setProp(p, t, n, !(prop?.value === true))}>
                            <PropValue prop={prop} />
                          </button>
                        ) : choosable && editable ? (
                          <button className="col-cell" onClick={(e) => valueMenu(e.currentTarget, p, n)}>
                            <PropValue prop={prop} />
                          </button>
                        ) : (
                          <PropValue prop={prop} />
                        )}
                      </td>
                    );
                  })}
                  <td className="col-time">{relTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && a.view === "board" && (
        <div className="col-board">
          {groups.map((g) => {
            const cards = rows.filter((p) => propText(propByName(p, a.groupBy)) === g);
            if (!g && cards.length === 0) return null;
            return (
              <div
                key={g || "_none"}
                className={`col-lane ${overGroup === g ? "is-over" : ""}`}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setOverGroup(g);
                }}
                onDragLeave={() => setOverGroup(null)}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setOverGroup(null);
                  const p = dragId ? pages[dragId] : null;
                  setDragId(null);
                  if (p) setProp(p, groupProp, a.groupBy, g || null);
                }}
              >
                <div className="col-lane-head">
                  {g ? <Chip prop={groupProp} value={g} /> : <span className="col-lane-none">No {a.groupBy.toLowerCase()}</span>}
                  <span className="col-count">{cards.length}</span>
                </div>
                {cards.map((p) => (
                  <button
                    key={p.id}
                    className={`col-card ${dragId === p.id ? "is-dragging" : ""}`}
                    draggable={editable}
                    onDragStart={(e) => {
                      setDragId(p.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => open(e, p.id)}
                  >
                    <span className="col-card-title">
                      <PageIcon icon={p.icon} size={16} />
                      <span className="bidi">{pageTitle(p)}</span>
                    </span>
                    <span className="col-card-props">
                      {propsOf(p)
                        .filter((x) => x.name !== a.groupBy && propText(x))
                        .slice(0, 3)
                        .map((x) => (
                          <PropValue key={x.id} prop={x} />
                        ))}
                    </span>
                  </button>
                ))}
                {editable && (
                  <button className="col-lane-add" onClick={() => createRow({ name: a.groupBy, value: g })}>
                    <Icon name="add" size={13} />
                    New
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && a.view === "gallery" && (
        <div className="col-gallery">
          {rows.map((p) => (
            <button key={p.id} className="col-tile" onClick={(e) => open(e, p.id)}>
              <span className="col-tile-art">{cover(p) ? <img src={cover(p)!} alt="" loading="lazy" /> : <PageIcon icon={p.icon} size={34} />}</span>
              <span className="col-tile-title bidi">{pageTitle(p)}</span>
              <span className="col-tile-sub bidi">{p.preview || relTime(p.updatedAt)}</span>
              <span className="col-card-props">
                {propsOf(p)
                  .filter((x) => propText(x))
                  .slice(0, 2)
                  .map((x) => (
                    <PropValue key={x.id} prop={x} />
                  ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && a.view === "list" && (
        <div className="col-list">
          {rows.map((p) => (
            <button key={p.id} className="col-row" onClick={(e) => open(e, p.id)}>
              <PageIcon icon={p.icon} size={17} />
              <span className="col-row-title bidi">{pageTitle(p)}</span>
              <span className="col-card-props">
                {propsOf(p)
                  .filter((x) => propText(x))
                  .slice(0, 3)
                  .map((x) => (
                    <PropValue key={x.id} prop={x} />
                  ))}
              </span>
              <span className="col-time">{relTime(p.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}
