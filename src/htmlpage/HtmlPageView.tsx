import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { api, errorMessage, isTauri, type HtmlCheck } from "../lib/api";
import { openExternal } from "../lib/links";
import { uiLanguage } from "../i18n/ui";
import { Segmented } from "../ui/Segmented";
import { EmptyState, Spinner } from "../ui/misc";
import { Icon } from "../ui/Icon";
import { ResourceHeader, useResource } from "../resources/views/ResourceHeader";
import { appTheme, composeHtmlPage } from "./compose";
import "./htmlpage.css";

type Mode = "page" | "source";
interface HtmlMeta {
  source?: string;
  state?: unknown;
}

const PAGE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * An HTML page (docs/HTML_PAGES.md): the page as it runs, in a sandboxed
 * frame with no network and an opaque origin, and its source beside it.
 * Each edit is checked and saved; a source that breaks a hard rule is kept
 * in the editor with the reasons, and the frame keeps the last good one.
 */
export function HtmlPageView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, setPage, error } = useResource(id);
  const [mode, setMode] = useState<Mode>("page");
  const html = (page?.metadata as { html?: HtmlMeta } | undefined)?.html;
  const [draft, setDraft] = useState<string | null>(null);
  const [check, setCheck] = useState<HtmlCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  const source = draft ?? html?.source ?? "";

  // Save the source a moment after the last keystroke.
  useEffect(() => {
    if (draft === null || draft === (html?.source ?? "")) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        const result = await api.htmlPageWrite(id, draft);
        setCheck(result);
        if (result.errors.length === 0) {
          setPage((p) => (p ? { ...p, metadata: { ...p.metadata, html: { ...(html ?? {}), source: draft } } } : p));
          setRevision((r) => r + 1);
        }
      } catch (e) {
        setCheck({ errors: [errorMessage(e)], warnings: [] });
      } finally {
        setSaving(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, html, id, setPage]);

  if (error) return <EmptyState icon="warning" title="This page could not be opened" text={error} />;
  if (!page || !meta) return <div className="page-loading"><Spinner /></div>;

  const status = saving ? (
    <span className="htmlpage-status"><Spinner size={12} /> Saving</span>
  ) : check && check.errors.length > 0 ? (
    <span className="htmlpage-status is-bad"><Icon name="warning" size={14} /> Not saved</span>
  ) : null;

  return (
    <div className={`res-view htmlpage is-${mode}`}>
      <ResourceHeader
        meta={meta}
        subtitle={status}
        actions={
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "page", label: "Page", icon: "page" },
              { value: "source", label: "Source", icon: "code" },
            ]}
          />
        }
      />
      <div className="htmlpage-body">
        {mode === "source" && (
          <div className="htmlpage-source">
            <SourceEditor value={source} onChange={setDraft} />
            {check && (check.errors.length > 0 || check.warnings.length > 0) && <CheckList check={check} />}
          </div>
        )}
        <HtmlFrame id={id} source={html?.source ?? ""} state={html?.state ?? null} revision={revision} />
      </div>
    </div>
  );
}

function CheckList({ check }: { check: HtmlCheck }) {
  return (
    <ul className="htmlpage-check" aria-live="polite">
      {check.errors.map((e) => (
        <li key={e} className="is-bad"><Icon name="warning" size={14} /><span>{e}</span></li>
      ))}
      {check.warnings.map((w) => (
        <li key={w}><Icon name="info" size={14} /><span>{w}</span></li>
      ))}
    </ul>
  );
}

/** A plain code editor: monospace, left to right, Tab indents. */
function SourceEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = el.value.slice(0, a) + "  " + el.value.slice(b);
    onChange(next);
    requestAnimationFrame(() => ref.current?.setSelectionRange(a + 2, a + 2));
  };
  return (
    <textarea
      ref={ref}
      className="htmlpage-editor"
      dir="ltr"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-label="HTML source"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * The running page. On the desktop it comes from whtml:, which sends its own
 * strict policy; in the web version it is built here. Either way the frame
 * may only run scripts: no same origin, no popups, no top navigation.
 */
export function HtmlFrame({ id, source, state, revision, home }: { id: string; source: string; state: unknown; revision: number; home?: () => unknown }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const lang = uiLanguage();
  const mock = Boolean((window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__);
  const useProtocol = isTauri && !mock;
  const saveTimer = useRef<number | null>(null);

  const saveState = useCallback(
    (text: string) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        // Viewers cannot keep state; the page still works for them.
        api.htmlPageSaveState(id, text).catch(() => undefined);
      }, 400);
    },
    [id],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const data = e.data as { worldsHtmlPage?: number; type?: string; height?: number; url?: string; id?: string; state?: string; title?: string };
      if (!data || data.worldsHtmlPage !== 1) return;
      switch (data.type) {
        case "ready":
          if (home) frame.current.contentWindow?.postMessage({ worldsHome: 1, data: home() }, "*");
          break;
        case "newPage":
          if (home)
            useStore
              .getState()
              .createPage({ title: typeof data.title === "string" ? data.title.slice(0, 200) : "" })
              .catch(() => undefined);
          break;
        case "height":
          if (typeof data.height === "number" && Number.isFinite(data.height)) setHeight(Math.min(Math.max(data.height, 120), 40000));
          break;
        case "openLink":
          if (typeof data.url === "string") void openExternal(data.url);
          break;
        case "openPage":
          if (typeof data.id === "string" && PAGE_ID.test(data.id) && useStore.getState().pages[data.id]) useStore.getState().openPage(data.id);
          break;
        case "save":
          if (typeof data.state === "string" && data.state.length <= 256 * 1024) saveState(data.state);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [saveState, home]);

  const common = {
    ref: frame,
    className: "htmlpage-frame",
    title: "HTML page",
    sandbox: "allow-scripts",
    referrerPolicy: "no-referrer" as const,
    style: { height },
  };
  return useProtocol ? (
    <iframe key={revision} {...common} src={`http://whtml.localhost/page/${encodeURIComponent(id)}?lang=${lang}&theme=${appTheme()}&v=${revision}`} />
  ) : (
    <iframe key={revision} {...common} srcDoc={composeHtmlPage(source, state, lang)} />
  );
}
