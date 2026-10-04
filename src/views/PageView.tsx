import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, errorMessage, fileUrl, isTauri } from "../lib/api";
import type { Page } from "../lib/types";
import { useStore, childrenOf, pageTitle } from "../state/store";
import { emit, on } from "../lib/bus";
import { PageEditor, whenSaved, type PageEditorHandle } from "../editor/PageEditor";
import { insertPaths } from "../editor/media";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Avatar, EmptyState, PageIcon, relTime, Spinner } from "../ui/misc";
import { menuAt } from "../ui/Menu";
import { EmojiPicker } from "../ui/EmojiPicker";
import { pageMenu, pageOps } from "../shell/pageActions";
import { Inspector, type InspectorPanel } from "./Inspector";
import { DiscordComposer } from "../discord/DiscordComposer";
import type { Editor } from "@tiptap/core";
import { PageCover, pickCover } from "../pages/PageCover";
import { PropertiesPanel } from "../pages/PropertiesPanel";
import { Outline } from "../pages/Outline";
import { newProperty, propsOf } from "../pages/properties";
import { isLight, useBannerTone } from "../profile/bannerColor";
import { FindBar, StatusBar, StickyTitle, Starters, ShortcutsSheet, SubpagesSection, RelatedPages, copyMarkdown, downloadMarkdown, printPage } from "../pages/PageChrome";

export function PageView({ pageId, paneId }: { pageId: string; paneId: string }) {
  const meta = useStore((s) => s.pages[pageId]);
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  // Only the latest request may land: switching pages quickly must never show
  // (and then edit) a page other than the one the route points at.
  const request = useRef(0);
  const load = useCallback(() => {
    const ticket = ++request.current;
    whenSaved(pageId)
      .then(() => api.page(pageId, true))
      .then((p) => {
        if (ticket !== request.current) return;
        setPage(p);
        setRev((r) => r + 1);
      })
      .catch((e) => ticket === request.current && setError(errorMessage(e)));
  }, [pageId]);

  useEffect(() => {
    setPage(undefined);
    setError(null);
    load();
  }, [load]);

  if (error) return <EmptyState icon="warning" title="This page could not be opened" text={error} />;
  if (page === undefined) return <div className="page-loading"><Spinner /></div>;
  if (page === null || !meta) {
    return (
      <div className="page-view">
        <EmptyState
          icon="page"
          title="Missing page"
          text="This page was permanently deleted or never existed."
          action={<button className="btn btn-tinted btn-standard" onClick={() => useStore.getState().open({ kind: "home" })}>Go Home</button>}
        />
      </div>
    );
  }
  return <LoadedPage key={`${page.id}:${rev}`} page={page} paneId={paneId} reload={load} />;
}

function LoadedPage({ page, paneId, reload }: { page: Page; paneId: string; reload: () => void }) {
  const meta = useStore((s) => s.pages[page.id]) ?? page;
  const profile = useStore((s) => s.profile);
  const pages = useStore((s) => s.pages);
  const subpages = useMemo(() => childrenOf(pages, page.id, { archived: false }), [pages, page.id]);
  const external = useStore((s) => s.externalRevision[page.id] ?? 0);
  const createPage = useStore((s) => s.createPage);
  const openPage = useStore((s) => s.openPage);
  const [title, setTitle] = useState(page.title);
  const [savedAt, setSavedAt] = useState(page.updatedAt);
  const [saving, setSaving] = useState(false);
  const [inspector, setInspector] = useState<InspectorPanel | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);
  const [composer, setComposer] = useState(false);
  const [backlinks, setBacklinks] = useState(page.backlinks);
  const editorRef = useRef<PageEditorHandle>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    let raf = 0;
    const grab = () => {
      const ed = editorRef.current?.editor ?? null;
      if (ed) setEditor(ed);
      else raf = requestAnimationFrame(grab);
    };
    grab();
    return () => cancelAnimationFrame(raf);
  }, []);
  const look = meta.look ?? {};
  // Controls floating over the cover take their ink from the picture under them.
  const coverTone = useBannerTone(meta.cover ? fileUrl(meta.cover) : null);
  const [find, setFind] = useState<null | "find" | "replace">(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const locked = !!(look as { locked?: boolean }).locked;

  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  // Page shortcuts, only while this page's pane is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!root.current || !root.current.closest(".pane.is-active, .pane:only-child")) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && k === "f") {
        e.preventDefault();
        setFind("find");
      } else if (e.ctrlKey && !e.shiftKey && k === "h") {
        e.preventDefault();
        setFind("replace");
      } else if (e.ctrlKey && e.shiftKey && k === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
      } else if (e.ctrlKey && e.altKey && k === "l") {
        e.preventDefault();
        setLook({ locked: !locked });
      } else if (e.ctrlKey && (k === "/" || e.code === "Slash")) {
        e.preventDefault();
        setShortcuts(true);
      } else if (k === "escape" && focusMode) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, focusMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("is-focus-mode", focusMode);
    return () => document.documentElement.classList.remove("is-focus-mode");
  }, [focusMode]);
  const setLook = async (patch: Record<string, unknown>) => {
    try {
      const m = await api.setPageMeta(page.id, "look", { ...look, ...patch });
      useStore.getState().patchPageLocal(m);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleTimer = useRef(0);

  // Title follows external renames when not being edited.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(meta.title);
  }, [meta.title]);

  useEffect(() => {
    if (external) api.page(page.id).then((p) => p && setBacklinks(p.backlinks));
  }, [external, page.id]);

  // New, empty page: put the caret in the title.
  useEffect(() => {
    if (!page.title && page.blocks.length === 0) titleRef.current?.focus();
  }, [page]);

  useEffect(() => autosize(titleRef.current), [title]);

  useEffect(() => {
    const offs = [
      on("page:info", ({ pageId, panel }) => pageId === page.id && setInspector(panel)),
      on("discord:compose", ({ pageId }) => pageId === page.id && setComposer(true)),
    ];
    return () => offs.forEach((f) => f());
  }, [page.id]);

  // Files dropped from Explorer onto this page.
  useEffect(() => {
    if (!isTauri) return;
    const un = getCurrentWebview().onDragDropEvent(async (e) => {
      if (e.payload.type !== "drop") return;
      const dpr = window.devicePixelRatio || 1;
      const x = e.payload.position.x / dpr;
      const y = e.payload.position.y / dpr;
      const el = document.elementFromPoint(x, y);
      if (!el || !root.current?.contains(el)) return;
      const ed = editorRef.current?.editor;
      if (!ed) return;
      const pos = ed.view.posAtCoords({ left: x, top: y })?.pos;
      await insertPaths(ed, page.id, e.payload.paths, pos);
    });
    return () => {
      un.then((f) => f());
    };
  }, [page.id]);

  const saveTitle = (v: string) => {
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(async () => {
      try {
        const m = await api.updatePage(page.id, { title: v });
        useStore.getState().patchPageLocal(m);
      } catch (e) {
        useStore.getState().toast({ message: errorMessage(e), tone: "error" });
      }
    }, 300);
  };

  const setIcon = async (icon: string | null) => {
    setEmojiAnchor(null);
    const m = await api.updatePage(page.id, { icon });
    useStore.getState().patchPageLocal(m);
  };

  return (
    <div className={`page-view font-${look.font ?? "default"} ${look.small ? "is-small" : ""} ${look.full ? "is-full" : ""} ${meta.cover ? `has-cover ${isLight(coverTone.luma) ? "cover-bottom-light" : "cover-bottom-dark"} ${isLight(coverTone.lumaTopRight) ? "cover-top-light" : "cover-top-dark"}` : ""} ${locked ? "is-locked" : ""} ${focusMode ? "is-focus" : ""}`} ref={root}>
      <StickyTitle page={meta} titleEl={titleRef} />
      {find && editor && <FindBar editor={editor} replace={find === "replace"} onClose={() => setFind(null)} />}
      <PageCover page={meta} />
      <Outline editor={editor} />
      <div className="page-column">
        <header className="page-head">
          <div className="page-head-top">
            <HeadCapsule glass={!!meta.cover} as="nav" className="crumbs" aria-label="Location">
              {page.breadcrumbs.map((c) => (
                <span key={c.id} className="crumb">
                  <button className="crumb-btn bidi" onClick={(e) => openPage(c.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
                    {c.icon && <PageIcon icon={c.icon} size={13} />}
                    <span>{c.title || "Untitled"}</span>
                  </button>
                  <Icon name="forward" size={11} className="crumb-sep" />
                </span>
              ))}
              {meta.archived && <span className="tag">Archived</span>}
            </HeadCapsule>
            <HeadCapsule glass={!!meta.cover} className="page-actions">
              <span className="save-state" aria-live="polite">
                {saving ? "Saving" : savedAt ? `Edited ${relTime(savedAt)}` : ""}
              </span>
              {locked && (
                <button className="lock-chip" onClick={() => setLook({ locked: false })} data-tip="Unlock to edit  Ctrl+Alt+L">
                  <Icon name="lock" size={12} />
                  Locked
                </button>
              )}
              <IconButton icon={meta.pinned ? "unpin" : "pin"} label={meta.pinned ? "Unpin" : "Pin"} active={meta.pinned} onClick={() => pageOps.togglePin(meta)} />
              <IconButton icon="discord" label="Send to Discord" onClick={() => setComposer(true)} />
              <IconButton icon="assistant" label="Ask Claude" onClick={() => emit("ai:open", { pageId: page.id })} />
              <IconButton icon="history" label="History" active={inspector === "history"} onClick={() => setInspector(inspector === "history" ? null : "history")} />
              <IconButton
                icon="more"
                label="More"
                onClick={(e) =>
                  menuAt(
                    e.currentTarget,
                    [
                      { label: "Page Info", icon: "info", onSelect: () => setInspector("info") },
                      { label: "Assistant Instructions", icon: "instructions", onSelect: () => setInspector("instructions") },
                      ...(meta.cover
                        ? [
                            { label: "Change Cover", icon: "image" as const, onSelect: () => pickCover(meta) },
                            {
                              label: "Remove Cover",
                              icon: "close" as const,
                              onSelect: () => api.updatePage(page.id, { cover: null }).then((m) => useStore.getState().patchPageLocal(m)),
                            },
                          ]
                        : [{ label: "Add Cover", icon: "image" as const, onSelect: () => pickCover(meta) }]),
                      { label: "Find and Replace", icon: "search", shortcut: "Ctrl+F", onSelect: () => setFind("find") },
                      { label: focusMode ? "Leave Focus Mode" : "Focus Mode", icon: "preview", shortcut: "Ctrl+Shift+F", onSelect: () => setFocusMode(!focusMode) },
                      { label: locked ? "Unlock Page" : "Lock Page", icon: "lock", shortcut: "Ctrl+Alt+L", onSelect: () => setLook({ locked: !locked }) },
                      {
                        label: "Export",
                        icon: "download",
                        submenu: [
                          { label: "Copy as Markdown", onSelect: () => copyMarkdown(page.id) },
                          { label: "Save as Markdown file", onSelect: () => downloadMarkdown(meta) },
                          { label: "Print or Save as PDF", onSelect: () => printPage() },
                        ],
                      },
                      { label: "Keyboard Shortcuts", icon: "keyboard", shortcut: "Ctrl+/", onSelect: () => setShortcuts(true) },
                      { kind: "separator" },
                      { kind: "label", label: "Style" },
                      { label: "Default font", checked: (look.font ?? "default") === "default", onSelect: () => setLook({ font: "default" }) },
                      { label: "Serif", checked: look.font === "serif", onSelect: () => setLook({ font: "serif" }) },
                      { label: "Mono", checked: look.font === "mono", onSelect: () => setLook({ font: "mono" }) },
                      { label: "Small text", checked: !!look.small, onSelect: () => setLook({ small: !look.small }) },
                      { label: "Full width", checked: !!look.full, onSelect: () => setLook({ full: !look.full }) },
                      { kind: "separator" },
                      ...pageMenu(meta, { inPage: true }),
                    ],
                    "end",
                  )
                }
              />
            </HeadCapsule>
          </div>

          <div className="page-head-adds">
            <button
              className={`page-icon-btn ${meta.icon ? "has-icon" : ""}`}
              aria-label="Change icon"
              onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())}
            >
              {meta.icon ? (
                <span className="page-icon-big">
                  <PageIcon icon={meta.icon} size={58} />
                </span>
              ) : (
                <span className="page-icon-add">
                  <Icon name="emoji" size={15} />
                  Add icon
                </span>
              )}
            </button>
            {!meta.cover && (
              <button className="page-icon-add page-cover-add" onClick={() => pickCover(meta)}>
                <Icon name="image" size={15} />
                Add cover
              </button>
            )}
            {propsOf(meta).length === 0 && (
              <button
                className="page-icon-add"
                onClick={() => api.setPageMeta(page.id, "properties", [newProperty("status", "Status")]).then((m) => useStore.getState().patchPageLocal(m))}
              >
                <Icon name="sliders" size={15} />
                Add properties
              </button>
            )}
          </div>

          <textarea
            ref={titleRef}
            className="page-title bidi"
            dir="auto"
            rows={1}
            value={title}
            placeholder="Untitled"
            spellCheck
            onChange={(e) => {
              setTitle(e.target.value);
              saveTitle(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || (e.key === "ArrowDown" && (e.target as HTMLTextAreaElement).selectionStart === title.length)) {
                e.preventDefault();
                editorRef.current?.focusStart();
              }
            }}
          />

          <div className="page-meta">
            <button className="owner-chip" onClick={() => setInspector("info")} aria-label="Owner">
              <Avatar id={profile?.avatar} name={profile?.displayName} size={18} />
              <span className="bidi">{profile?.displayName || "You"}</span>
            </button>
            {page.instructions.length > 0 && (
              <button className="meta-chip" onClick={() => setInspector("instructions")}>
                <Icon name="instructions" size={13} />
                {page.instructions.length} instruction{page.instructions.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <PropertiesPanel page={meta} />
        </header>

        <Starters editor={editor} pageId={page.id} />
        <PageEditor
          ref={editorRef}
          page={page}
          onSaved={(at) => setSavedAt(at)}
          onSaving={setSaving}
        />

        <section className="page-foot">
          <SubpagesSection page={meta} onNew={() => createPage({ parentId: page.id }, "current")} />
          <RelatedPages page={meta} />
          <div className="foot-head foot-legacy">
            <span>Subpages</span>
            <button className="chip-btn" onClick={() => createPage({ parentId: page.id }, "current")}>
              <Icon name="add" size={13} />
              New subpage
            </button>
          </div>
          {subpages.length === 0 ? (
            <div className="foot-empty">No subpages yet. Pages you create here stay organized under “{pageTitle(meta)}”.</div>
          ) : (
            <div className="sub-grid">
              {subpages.map((s) => (
                <button key={s.id} className="sub-card" onClick={(e) => openPage(s.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
                  <PageIcon icon={s.icon} size={16} />
                  <span className="sub-title bidi">{pageTitle(s)}</span>
                  <span className="sub-time">{relTime(s.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}

          {backlinks.length > 0 && (
            <>
              <div className="foot-head">
                <span>Mentioned in</span>
              </div>
              <div className="backlinks">
                {backlinks.map((b) => (
                  <button key={`${b.pageId}-${b.blockId}`} className="backlink" onClick={(e) => openPage(b.pageId, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
                    <PageIcon icon={b.icon} size={15} />
                    <span className="backlink-main">
                      <span className="backlink-title bidi">{b.title || "Untitled"}</span>
                      {b.excerpt && <span className="backlink-excerpt bidi">{b.excerpt}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <StatusBar editor={editor} saving={saving} savedAt={savedAt} locked={locked} />
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
      {inspector && (
        <Inspector
          page={page}
          meta={meta}
          panel={inspector}
          onPanel={setInspector}
          onClose={() => setInspector(null)}
          onRestored={() => reload()}
          paneId={paneId}
        />
      )}
      {emojiAnchor && <EmojiPicker anchor={emojiAnchor} onPick={setIcon} onClose={() => setEmojiAnchor(null)} hasIcon={!!meta.icon} pageId={page.id} />}
      {composer && (
        <DiscordComposer
          pageId={page.id}
          onClose={() => setComposer(false)}
          getBlocks={async () => {
            await editorRef.current?.flush();
            return undefined;
          }}
        />
      )}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * The crumbs and page actions: plain on a page, a glass capsule when they sit
 * on a cover image (the engine then picks light or dark ink for the cover).
 */
function HeadCapsule({ glass, as = "div", className, children, ...rest }: { glass: boolean; as?: "div" | "nav"; className: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  if (!glass) {
    const Tag = as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }
  return (
    <Glass as={as} className={`${className} is-glass`} contentClassName={`${className}-row`} material="control" layer={LAYER.chrome} radius="var(--r-capsule)" {...rest}>
      {children}
    </Glass>
  );
}
