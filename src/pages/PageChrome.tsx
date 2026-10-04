import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore, childrenOf, pageTitle } from "../state/store";
import { findKey } from "../editor/extensions/pages3";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { PageIcon, relTime } from "../ui/misc";
import { ProductIcon } from "../ui/ProductIcon";
import { propsOf, propText } from "./properties";

const toast = (message: string, tone: "error" | "success" | "info" = "info") => useStore.getState().toast({ message, tone });

// ---------------------------------------------------------------------------
// Find and replace bar (Ctrl+F, Ctrl+H)
// ---------------------------------------------------------------------------

export function FindBar({ editor, replace: startReplace, onClose }: { editor: Editor; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState(() => {
    const { from, to } = editor.state.selection;
    return from !== to ? editor.state.doc.textBetween(from, to, " ").slice(0, 80) : "";
  });
  const [rep, setRep] = useState("");
  const [showRep, setShowRep] = useState(startReplace);
  const [matchCase, setMatchCase] = useState(false);
  const [, force] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    editor.commands.setFind(q, matchCase);
  }, [q, matchCase, editor]);
  useEffect(() => {
    const t = () => force((n) => n + 1);
    editor.on("transaction", t);
    return () => {
      editor.off("transaction", t);
      editor.commands.clearFind();
    };
  }, [editor]);

  const st = findKey.getState(editor.state);
  const count = st?.matches.length ?? 0;
  const at = count ? (st?.index ?? 0) + 1 : 0;

  return (
    <div className="find-bar" role="search">
      <div className="find-row">
        <Icon name="search" size={14} />
        <input
          ref={input}
          dir="auto"
          value={q}
          placeholder="Find in page"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.commands.findStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") onClose();
          }}
        />
        <span className="find-count">{q ? `${at}/${count}` : ""}</span>
        <button className={`find-btn ${matchCase ? "is-on" : ""}`} onClick={() => setMatchCase(!matchCase)} data-tip="Match case">
          Aa
        </button>
        <button className="find-btn" onClick={() => editor.commands.findStep(-1)} aria-label="Previous" disabled={!count}>
          <Icon name="back" size={13} className="rot90" />
        </button>
        <button className="find-btn" onClick={() => editor.commands.findStep(1)} aria-label="Next" disabled={!count}>
          <Icon name="forward" size={13} className="rot90" />
        </button>
        <button className={`find-btn ${showRep ? "is-on" : ""}`} onClick={() => setShowRep(!showRep)} data-tip="Replace  Ctrl+H">
          <Icon name="repeat" size={13} />
        </button>
        <button className="find-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={13} />
        </button>
      </div>
      {showRep && (
        <div className="find-row">
          <Icon name="edit" size={14} />
          <input
            dir="auto"
            value={rep}
            placeholder="Replace with"
            onChange={(e) => setRep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor.commands.replaceCurrent(rep);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <button className="find-text-btn" disabled={!count || !editor.isEditable} onClick={() => editor.commands.replaceCurrent(rep)}>
            Replace
          </button>
          <button
            className="find-text-btn"
            disabled={!count || !editor.isEditable}
            onClick={() => {
              const n = count;
              editor.commands.replaceAll(rep);
              toast(`Replaced ${n} match${n === 1 ? "" : "es"}`, "success");
            }}
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar: words, characters, reading time, selection, save state
// ---------------------------------------------------------------------------

export function StatusBar({ editor, saving, savedAt, locked }: { editor: Editor | null; saving: boolean; savedAt: number; locked: boolean }) {
  const [stats, setStats] = useState({ words: 0, chars: 0, sel: 0 });
  useEffect(() => {
    if (!editor) return;
    let t = 0;
    const read = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const text = editor.state.doc.textContent;
        const { from, to } = editor.state.selection;
        const selText = from !== to ? editor.state.doc.textBetween(from, to, " ") : "";
        setStats({
          words: text.trim() ? text.trim().split(/\s+/).length : 0,
          chars: text.replace(/\s/g, "").length,
          sel: selText.trim() ? selText.trim().split(/\s+/).length : 0,
        });
      }, 120);
    };
    read();
    editor.on("transaction", read);
    return () => {
      editor.off("transaction", read);
      window.clearTimeout(t);
    };
  }, [editor]);
  const minutes = Math.max(1, Math.round(stats.words / 200));
  return (
    <div className="status-bar" aria-live="polite">
      {locked && (
        <span className="sb-item sb-lock">
          <Icon name="lock" size={11} />
          Locked
        </span>
      )}
      <span className="sb-item">{stats.sel ? `${stats.sel} of ${stats.words.toLocaleString()} words` : `${stats.words.toLocaleString()} words`}</span>
      <span className="sb-item">{stats.chars.toLocaleString()} characters</span>
      <span className="sb-item">{minutes} min read</span>
      <span className="sb-item sb-save">{saving ? "Saving" : savedAt ? `Saved ${relTime(savedAt)}` : ""}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky title: once the title scrolls away, it rides along in a glass capsule
// ---------------------------------------------------------------------------

export function StickyTitle({ page, titleEl }: { page: PageMeta; titleEl: React.RefObject<HTMLElement | null> }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = titleEl.current;
    const scroller = el?.closest(".pane-scroll");
    if (!el || !scroller) return;
    const io = new IntersectionObserver(([e]) => setOn(!e.isIntersecting && e.boundingClientRect.top < 100), { root: scroller, rootMargin: "-70px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [titleEl]);
  return (
    <div className={`sticky-title ${on ? "is-on" : ""}`} aria-hidden={!on}>
      <button className="sticky-title-btn" onClick={() => titleEl.current?.closest(".pane-scroll")?.scrollTo({ top: 0, behavior: "smooth" })}>
        <PageIcon icon={page.icon} size={16} />
        <span className="bidi">{pageTitle(page)}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty page starters
// ---------------------------------------------------------------------------

export function Starters({ editor, pageId }: { editor: Editor | null; pageId: string }) {
  const [hidden, setHidden] = useState(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    if (!editor) return;
    const check = () => setEmpty(editor.state.doc.childCount <= 1 && editor.state.doc.textContent.trim() === "" && editor.state.doc.firstChild?.type.name === "paragraph");
    check();
    editor.on("update", check);
    return () => {
      editor.off("update", check);
    };
  }, [editor]);
  if (!editor || hidden || !empty || !editor.isEditable) return null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const run = (fn: () => void) => {
    fn();
    setHidden(true);
  };
  const items: { icon: string; label: string; run: () => void }[] = [
    { icon: "checklist", label: "Checklist", run: () => editor.chain().focus().setContent("<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p></p></li></ul>").run() },
    {
      icon: "meeting",
      label: "Meeting notes",
      run: () =>
        editor.chain().focus().setContent(`<h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><p></p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`).run(),
    },
    { icon: "notebook", label: "Journal entry", run: () => editor.chain().focus().setContent(`<h2>${today}</h2><p></p>`).run() },
    { icon: "kanban", label: "Board", run: () => editor.chain().focus().clearContent().insertCollection({ view: "board" }).run() },
    { icon: "table", label: "Table of subpages", run: () => editor.chain().focus().clearContent().insertCollection({ view: "table" }).run() },
    { icon: "layers", label: "Two columns", run: () => editor.chain().focus().clearContent().insertColumns(2).run() },
    { icon: "image", label: "Gallery", run: () => editor.chain().focus().clearContent().insertGallery().run() },
  ];
  return (
    <div className="starters" data-page={pageId}>
      <div className="starters-title">Start with</div>
      <div className="starters-row">
        {items.map((it) => (
          <button key={it.label} className="starter" onClick={() => run(it.run)}>
            <ProductIcon name={it.icon} size={26} />
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts sheet (Ctrl+/)
// ---------------------------------------------------------------------------

const SHORTCUTS: [string, [string, string][]][] = [
  ["Writing", [["Bold", "Ctrl+B"], ["Italic", "Ctrl+I"], ["Strikethrough", "Ctrl+Shift+S"], ["Inline code", "Ctrl+E"], ["Link", "Ctrl+K in a selection"], ["Highlight", "Ctrl+Shift+H"]]],
  ["Blocks", [["Block menu", "/"], ["Mention a page", "@ or [["], ["Heading 1 to 3", "# ## ###"], ["List", "- or 1."], ["Checklist", "[]"], ["Quote", ">"], ["Code", "```"], ["Divider", "---"], ["Duplicate block", "Ctrl+D"]]],
  ["Page", [["Find", "Ctrl+F"], ["Replace", "Ctrl+H"], ["Focus mode", "Ctrl+Shift+F"], ["Lock page", "Ctrl+Alt+L"], ["Toggle sidebar", "Ctrl+Shift+L"], ["Shortcuts", "Ctrl+/"]]],
  ["Worlds", [["Command palette", "Ctrl+K"], ["New page", "Ctrl+N"], ["Ask Claude", "Ctrl+J"], ["New tab", "Ctrl+T"], ["Split right", "Ctrl+\\"], ["Settings", "Ctrl+,"]]],
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={680} className="shortcuts-sheet">
      <div className="sc-grid">
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group} className="sc-group">
            <h3>{group}</h3>
            {rows.map(([label, keys]) => (
              <div key={label} className="sc-row">
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function pageMarkdown(pageId: string): Promise<string> {
  return api.pageMarkdown(pageId);
}

export async function copyMarkdown(pageId: string) {
  try {
    await navigator.clipboard.writeText(await pageMarkdown(pageId));
    toast("Copied as Markdown", "success");
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export async function downloadMarkdown(page: PageMeta) {
  try {
    const md = await pageMarkdown(page.id);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${(pageTitle(page) || "page").replace(/[\\/:*?"<>|]/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export function printPage() {
  document.body.classList.add("is-printing");
  setTimeout(() => {
    window.print();
    document.body.classList.remove("is-printing");
  }, 60);
}

// ---------------------------------------------------------------------------
// Subpages and related pages
// ---------------------------------------------------------------------------

export function SubpagesSection({ page, onNew }: { page: PageMeta; onNew: () => void }) {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const subs = useMemo(() => childrenOf(pages, page.id, { archived: false }), [pages, page.id]);
  return (
    <>
      <div className="foot-head">
        <span>Subpages</span>
        <span className="foot-count">{subs.length || ""}</span>
        <span className="grow" />
        <button className="chip-btn" onClick={onNew}>
          <Icon name="add" size={13} />
          New subpage
        </button>
      </div>
      {subs.length === 0 ? (
        <div className="foot-empty">No subpages yet. Pages you create here stay organized under “{pageTitle(page)}”.</div>
      ) : (
        <div className="sub-grid2">
          {subs.map((s) => (
            <button key={s.id} className="sub-card2" onClick={(e) => openPage(s.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
              <span className="sub-art">{s.cover ? <img src={fileUrl(s.cover)} alt="" loading="lazy" /> : <PageIcon icon={s.icon} size={28} />}</span>
              <span className="sub-body">
                <span className="sub-title bidi">{pageTitle(s)}</span>
                <span className="sub-meta">
                  {propsOf(s)
                    .filter((p) => propText(p))
                    .slice(0, 2)
                    .map((p) => (
                      <span key={p.id} className="sub-prop bidi">
                        {propText(p)}
                      </span>
                    ))}
                  <span className="sub-time">{relTime(s.updatedAt)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Pages that share tags, a status, or title words with this one. */
export function RelatedPages({ page }: { page: PageMeta }) {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const related = useMemo(() => {
    const tags = new Set(propsOf(page).flatMap((p) => (Array.isArray(p.value) ? p.value.map((v) => String(v).toLowerCase()) : [])));
    const words = new Set(pageTitle(page).toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    return Object.values(pages)
      .filter((p) => p.id !== page.id && p.kind === "page" && !p.deletedAt && !p.archived && p.parentId !== page.id && page.parentId !== p.id)
      .map((p) => {
        let score = 0;
        for (const pr of propsOf(p)) if (Array.isArray(pr.value)) for (const v of pr.value) if (tags.has(String(v).toLowerCase())) score += 3;
        for (const w of pageTitle(p).toLowerCase().split(/\s+/)) if (words.has(w)) score += 2;
        if (p.parentId && p.parentId === page.parentId) score += 1;
        return { p, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt)
      .slice(0, 6)
      .map((x) => x.p);
  }, [pages, page]);
  if (!related.length) return null;
  return (
    <>
      <div className="foot-head">
        <span>Related</span>
      </div>
      <div className="related">
        {related.map((p) => (
          <button key={p.id} className="related-chip" onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : "current")}>
            <PageIcon icon={p.icon} size={15} />
            <span className="bidi">{pageTitle(p)}</span>
          </button>
        ))}
      </div>
    </>
  );
}
