import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { Icon, type IconName } from "../../ui/Icon";
import { PageIcon } from "../../ui/misc";
import { useStore, pageTitle } from "../../state/store";
import { slashItems, type SlashItem } from "../slashItems";

// ---------------------------------------------------------------------------
// Generic list
// ---------------------------------------------------------------------------

export interface ListEntry {
  key: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  emoji?: string | null;
  group?: string;
  hint?: string;
}

interface ListProps {
  items: ListEntry[];
  onPick: (i: number) => void;
  empty: string;
}

export interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SuggestList = forwardRef<ListHandle, ListProps>(function SuggestList({ items, onPick, empty }, ref) {
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(0), [items]);
  useEffect(() => {
    list.current?.querySelector(".sg-item.is-sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === "ArrowDown") {
        setSel((s) => (s + 1) % Math.max(1, items.length));
        return true;
      }
      if (e.key === "ArrowUp") {
        setSel((s) => (s - 1 + items.length) % Math.max(1, items.length));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (items[sel]) onPick(sel);
        return true;
      }
      return false;
    },
  }));
  let lastGroup: string | undefined;
  return (
    <Glass material="dense" layer={LAYER.menu} className="suggest" radius="var(--r-lg)">
      <div className="sg-list scroll" ref={list} role="listbox">
        {items.length === 0 && <div className="sg-empty">{empty}</div>}
        {items.map((it, i) => {
          const header = it.group && it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {header && <div className="sg-group">{header}</div>}
              <div
                role="option"
                aria-selected={i === sel}
                className={`sg-item ${i === sel ? "is-sel" : ""}`}
                onPointerMove={() => sel !== i && setSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(i);
                }}
              >
                <span className="sg-icon">{it.emoji ? <PageIcon icon={it.emoji} size={16} /> : it.icon ? <Icon name={it.icon} size={16} /> : null}</span>
                <span className="sg-main">
                  <span className="sg-title bidi">{it.title}</span>
                  {it.subtitle && <span className="sg-sub bidi">{it.subtitle}</span>}
                </span>
                {it.hint && <span className="sg-hint">{it.hint}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Glass>
  );
});

/** Positions a ReactRenderer'd list at the caret and wires keyboard handling. */
function popupRenderer<T>(toEntries: (items: T[]) => ListEntry[], empty: string): SuggestionOptions<T>["render"] {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
    let host: HTMLDivElement | null = null;
    let current: SuggestionProps<T> | null = null;
    const place = (props: SuggestionProps<T>) => {
      const rect = props.clientRect?.();
      if (!rect || !host) return;
      const h = host.firstElementChild?.getBoundingClientRect().height ?? 320;
      const below = rect.bottom + 6 + h < window.innerHeight - 8;
      host.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
      host.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - h - 6)}px`;
    };
    const propsFor = (p: SuggestionProps<T>): ListProps => ({
      items: toEntries(p.items),
      onPick: (i) => p.command(p.items[i] as never),
      empty,
    });
    return {
      onStart: (props) => {
        current = props;
        host = document.createElement("div");
        host.className = "suggest-host";
        document.body.appendChild(host);
        renderer = new ReactRenderer(SuggestList, { props: propsFor(props), editor: props.editor });
        host.appendChild(renderer.element);
        requestAnimationFrame(() => current && place(current));
      },
      onUpdate: (props) => {
        current = props;
        renderer?.updateProps(propsFor(props));
        requestAnimationFrame(() => current && place(current));
      },
      onKeyDown: ({ event }) => {
        if (event.key === "Escape") {
          host?.remove();
          renderer?.destroy();
          host = null;
          renderer = null;
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit: () => {
        host?.remove();
        renderer?.destroy();
        host = null;
        renderer = null;
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Slash command
// ---------------------------------------------------------------------------

export interface EditorContext {
  pageId: string;
}

export const SlashCommand = Extension.create<{ getContext: () => EditorContext }>({
  name: "slashCommand",
  addOptions() {
    return { getContext: () => ({ pageId: "" }) };
  },
  addProseMirrorPlugins() {
    const getContext = this.options.getContext;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("worlds-slash"),
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        allow: ({ state, range }) => {
          // Not inside code blocks.
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== "codeBlock";
        },
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          const all = slashItems();
          if (!q) return all;
          // Rank: title starts with the query, a title word does, the title contains it, then keywords.
          const score = (i: SlashItem) => {
            const t = i.title.toLowerCase();
            const k = (i.keywords ?? "").toLowerCase();
            if (t.startsWith(q)) return 0;
            if (t.split(/\s+/).some((w) => w.startsWith(q))) return 1;
            if (t.includes(q)) return 2;
            if (k.split(/\s+/).some((w) => w.startsWith(q))) return 3;
            if (k.includes(q)) return 4;
            // "to-do", "todo", "to do" all find the checklist.
            const bare = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, "");
            const bq = bare(q);
            if (bq && (bare(t).includes(bq) || bare(k).includes(bq))) return 5;
            return 9;
          };
          return all
            .map((i) => ({ i, s: score(i) }))
            .filter((x) => x.s < 9)
            .sort((a, b) => a.s - b.s)
            .map((x) => x.i)
            .slice(0, 14);
        },
        command: ({ editor, range, props }) => {
          props.run(editor as Editor, range as Range, getContext());
        },
        render: popupRenderer<SlashItem>(
          (items) => items.map((i) => ({ key: i.id, title: i.title, subtitle: i.subtitle, icon: i.icon, group: i.group, hint: i.hint })),
          "No matching blocks",
        ),
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// @ page mentions (stored structurally: pageMention { id, label })
// ---------------------------------------------------------------------------

interface MentionItem {
  id: string;
  label: string;
  emoji: string | null;
  parent?: string;
  create?: boolean;
}

export const PageMention = Mention.extend({
  name: "pageMention",
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute("data-id"), renderHTML: (a) => ({ "data-id": a.id }) },
      label: { default: "", parseHTML: (el) => el.getAttribute("data-label"), renderHTML: (a) => ({ "data-label": a.label }) },
    };
  },
}).configure({
  HTMLAttributes: { class: "mention", dir: "auto" },
  renderText: ({ node }) => `@${node.attrs.label}`,
  renderHTML: ({ node, options }) => [
    "span",
    { ...options.HTMLAttributes, "data-type": "pageMention", "data-id": node.attrs.id, "data-label": node.attrs.label },
    `@${resolveTitle(node.attrs.id, node.attrs.label)}`,
  ],
  suggestion: {
    char: "@",
    pluginKey: new PluginKey("worlds-mention"),
    allowSpaces: true,
    items: ({ query }): MentionItem[] => {
      const pages = useStore.getState().pages;
      const q = query.toLowerCase().trim();
      const list: MentionItem[] = Object.values(pages)
        .filter((p) => p.kind === "page" && !p.deletedAt)
        .map((p) => ({ p, t: pageTitle(p).toLowerCase() }))
        .filter(({ t }) => !q || t.includes(q))
        .sort((a, b) => {
          const as = a.t.startsWith(q) ? 0 : 1;
          const bs = b.t.startsWith(q) ? 0 : 1;
          return as - bs || (b.p.openedAt ?? b.p.updatedAt) - (a.p.openedAt ?? a.p.updatedAt);
        })
        .slice(0, 8)
        .map(({ p }) => ({ id: p.id, label: pageTitle(p), emoji: p.icon, parent: p.parentId ? pageTitle(pages[p.parentId]) : undefined }));
      if (q && !list.some((x) => x.label.toLowerCase() === q)) {
        list.push({ id: "", label: query.trim(), emoji: null, create: true });
      }
      return list;
    },
    command: ({ editor, range, props }) => {
      const item = props as unknown as MentionItem;
      const insert = (id: string, label: string) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [{ type: "pageMention", attrs: { id, label } }, { type: "text", text: " " }])
          .run();
      };
      if (item.create) {
        import("../../lib/api").then(async ({ api }) => {
          const meta = await api.createPage({ title: item.label });
          await useStore.getState().refreshPages();
          insert(meta.id, meta.title);
        });
      } else insert(item.id, item.label);
    },
    render: popupRenderer<MentionItem>(
      (items) =>
        items.map((i) =>
          i.create
            ? { key: "create", title: `Create “${i.label}”`, icon: "add" as IconName, subtitle: "New page" }
            : { key: i.id, title: i.label, emoji: i.emoji, icon: "page" as IconName, subtitle: i.parent },
        ),
      "No pages yet. Keep typing to create one.",
    ),
  },
});

/** Mentions always show the page's current title. */
export function resolveTitle(id: string | null, fallback: string): string {
  if (!id) return fallback;
  const p = useStore.getState().pages[id];
  if (!p) return fallback || "Missing page";
  if (p.deletedAt) return `${pageTitle(p)} (deleted)`;
  return pageTitle(p);
}
