import { useEffect, useMemo, useState } from "react";
import { useStore, pageTitle } from "../state/store";
import { Popover } from "../ui/Menu";
import { PageIcon } from "../ui/misc";
import { ProductIcon } from "../ui/ProductIcon";
import { isResource } from "../resources/kinds";

/** A group of Worlds tools the user can point Claude at with @. */
export interface ToolRef {
  id: string;
  label: string;
  icon: string;
  note: string;
  tools: string[];
}

export const MENTION_TOOLS: ToolRef[] = [
  { id: "pages", label: "Pages", icon: "pages", note: "Create, rename, move, archive and edit pages", tools: ["pages_create", "pages_create_many", "pages_rename", "pages_move", "pages_append_markdown", "pages_replace_content", "blocks_update"] },
  { id: "search", label: "Find", icon: "search", note: "Search text, tags, status and properties", tools: ["pages_search", "pages_query", "pages_find_text", "pages_tree"] },
  { id: "layout", label: "Layout", icon: "kanban", note: "Columns, toggles, boards, tables and galleries", tools: ["blocks_insert_layout"] },
  { id: "properties", label: "Properties", icon: "tag", note: "Status, tags, dates and fields on pages", tools: ["pages_set_properties", "pages_bulk", "pages_query"] },
  { id: "edit", label: "Find and replace", icon: "writing", note: "Change wording across a page", tools: ["pages_find_text", "pages_replace_text"] },
  { id: "style", label: "Covers and style", icon: "image", note: "Cover images, icons, fonts and width", tools: ["pages_set_cover", "pages_set_icon", "pages_set_style"] },
  { id: "profile", label: "Profile", icon: "profile", note: "Bio, avatar, banner and profile blocks", tools: ["profile_read", "profile_update", "profile_blocks_add", "profile_blocks_update", "profile_blocks_move", "profile_set_image"] },
  { id: "discord", label: "Discord", icon: "discord", note: "Preview and send to Discord, with your approval", tools: ["discord_preview", "discord_send", "discord_edit", "discord_inspect"] },
  { id: "automations", label: "Automations", icon: "automations", note: "Schedules and recurring sends", tools: ["automations_list", "automations_create", "automations_update", "automations_run", "automations_runs"] },
  { id: "templates", label: "Templates", icon: "templates", note: "Start from or save templates", tools: ["templates_list", "templates_instantiate", "templates_create_from_page"] },
  { id: "files", label: "Media and files", icon: "folder", note: "Attachments and recent images", tools: ["attachments_list", "attachments_add", "attachments_insert"] },
  { id: "history", label: "History", icon: "activity", note: "Versions, undo and recent activity", tools: ["history_read", "versions_list", "versions_restore", "history_undo"] },
  { id: "chats", label: "Conversations", icon: "claude", note: "Read earlier chats with Claude", tools: ["chats_search", "chats_read"] },
  { id: "time", label: "Date and time", icon: "clock", note: "Today's date for plans and schedules", tools: ["time_now", "workspace_overview"] },
];

export type MentionPick =
  | { kind: "files" }
  | { kind: "context" }
  | { kind: "chat" }
  | { kind: "tool"; tool: ToolRef }
  | { kind: "page"; id: string; title: string };

interface Row {
  key: string;
  section: string;
  label: string;
  note?: string;
  icon: { product?: string; page?: string | null };
  pick: MentionPick;
}

/** The @ menu: Add, Tools and Pages, filtered as you type, with keyboard navigation. */
export function MentionMenu({
  anchor,
  query,
  excludeTools,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  query: string;
  excludeTools: string[];
  onPick: (p: MentionPick) => void;
  onClose: () => void;
}) {
  const pages = useStore((s) => s.pages);
  const [sel, setSel] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = (s: string) => !q || s.toLowerCase().includes(q);
    const add: Row[] = [
      { key: "files", section: "Add", label: "Files", note: "Images, PDFs and documents", icon: { product: "file" }, pick: { kind: "files" } as MentionPick },
      { key: "context", section: "Add", label: "Work on a page", note: "Claude reads and edits it", icon: { product: "pages" }, pick: { kind: "context" } as MentionPick },
      { key: "chat", section: "Add", label: "A conversation", note: "Bring in an earlier chat", icon: { product: "chat" }, pick: { kind: "chat" } as MentionPick },
    ].filter((r) => hit(`${r.label} ${r.note}`));
    const tools: Row[] = MENTION_TOOLS.filter((t) => !excludeTools.includes(t.id) && hit(`${t.label} ${t.note} ${t.tools.join(" ")}`)).map((t) => ({
      key: `tool:${t.id}`,
      section: "Tools",
      label: t.label,
      note: t.note,
      icon: { product: t.icon },
      pick: { kind: "tool", tool: t },
    }));
    const pageRows: Row[] = q
      ? Object.values(pages)
          .filter((p) => isResource(p) && !p.deletedAt && pageTitle(p).toLowerCase().includes(q))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 6)
          .map((p) => ({ key: `page:${p.id}`, section: "Pages", label: pageTitle(p), icon: { page: p.icon }, pick: { kind: "page", id: p.id, title: pageTitle(p) } }))
      : [];
    return [...add, ...tools, ...pageRows];
  }, [pages, query, excludeTools]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((v) => Math.min(rows.length - 1, v + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((v) => Math.max(0, v - 1));
      } else if ((e.key === "Enter" || e.key === "Tab") && rows[sel]) {
        e.preventDefault();
        e.stopPropagation();
        onPick(rows[sel].pick);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rows, sel, onPick]);

  useEffect(() => {
    document.querySelector(`.mention-menu [data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <Popover anchor={new DOMRect(anchor.left, anchor.top - 8, anchor.width, 0)} onClose={onClose} width={Math.min(560, Math.max(360, anchor.width))} className="mention-menu">
      <div className="mm-list scroll">
        {rows.length === 0 && <div className="sg-empty">Nothing matches “{query}”</div>}
        {rows.map((r, i) => (
          <div key={r.key}>
            {(i === 0 || rows[i - 1].section !== r.section) && <div className="mm-section">{r.section}</div>}
            <div
              data-row={i}
              className={`mm-row ${i === sel ? "is-sel" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(r.pick);
              }}
              onPointerMove={() => setSel(i)}
            >
              <span className="mm-icon">{r.icon.product ? <ProductIcon name={r.icon.product} size={20} /> : <PageIcon icon={r.icon.page ?? null} size={17} />}</span>
              <span className="mm-label bidi">{r.label}</span>
              {r.note && <span className="mm-note">{r.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </Popover>
  );
}
