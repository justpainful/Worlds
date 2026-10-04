import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorMessage } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import { Spinner } from "../../ui/misc";

export type PreviewInfo =
  | { kind: "pdf"; url: string }
  | { kind: "slides"; slides: string[]; width?: number; height?: number; original: string }
  | { kind: "sheet"; url: string; name: string }
  | { kind: "docx"; url: string }
  | { kind: "text"; url: string; name: string; size: number }
  | { kind: "audio"; url: string }
  | { kind: "none" }
  | { kind: "pending" };

const PREVIEWABLE = /\.(pdf|pptx?|ppsx?|pptm|odp|docx|docm|xlsx|xls|xlsm|xlsb|ods|csv|tsv|txt|md|markdown|json|jsonc|log|ini|toml|ya?ml|xml|html|css|[jt]sx?|py|rs|cs|lua|sql|sh|ps1|bat|go|java|c|h|cpp|hpp|kt|swift|php|rb|env|mp3|wav|m4a|ogg|flac|aac)$/i;

export function canPreview(name: string, mime: string): boolean {
  return PREVIEWABLE.test(name) || mime.startsWith("audio/");
}

/** In-page viewer for an attachment. Nothing opens in another app. */
export function FilePreview({ attachmentId, name }: { attachmentId: string; name: string }) {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const load = () =>
      api
        .previewPrepare(attachmentId)
        .then((r) => {
          if (cancelled) return;
          const p = r as PreviewInfo & { pending?: boolean };
          // Another view is already rendering this file; check again shortly.
          if (p.pending && tries++ < 60) return void window.setTimeout(load, 1500);
          setInfo(p.pending ? { kind: "none" } : p);
        })
        .catch((e) => !cancelled && setError(errorMessage(e)));
    load();
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (error) {
    return (
      <div className="fp-state">
        <Icon name="warning" size={16} />
        <span>{error}</span>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="fp-state">
        <Spinner size={15} />
        <span>{/\.(pptx?|ppsx?|pptm|odp)$/i.test(name) ? "Rendering slides" : "Preparing preview"}</span>
      </div>
    );
  }
  switch (info.kind) {
    case "slides":
      return <SlidesViewer slides={info.slides} ratio={info.width && info.height ? info.width / info.height : 16 / 9} name={name} />;
    case "pdf":
      return <iframe className="fp-pdf" src={`${info.url}#view=FitH`} title={name} />;
    case "sheet":
      return <SheetViewer url={info.url} name={name} />;
    case "docx":
      return <DocxViewer url={info.url} />;
    case "text":
      return <TextViewer url={info.url} size={info.size} />;
    case "audio":
      return (
        <div className="fp-audio">
          <audio controls preload="metadata" src={info.url} />
        </div>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function SlidesViewer({ slides, ratio, name }: { slides: string[]; ratio: number; name: string }) {
  const [i, setI] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const go = useCallback((n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))), [slides.length]);

  useEffect(() => {
    strip.current?.querySelector(".fp-thumb.is-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [i]);

  if (!slides.length) return <div className="fp-state">This presentation has no slides.</div>;
  return (
    <div className="fp-slides" tabIndex={0} onKeyDown={(e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); go(i + 1); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); go(i - 1); }
    }}>
      <div className="fp-stage" style={{ aspectRatio: String(ratio) }}>
        <img src={slides[i]} alt={`Slide ${i + 1}`} draggable={false} />
        <button className="fp-nav prev" aria-label="Previous slide" disabled={i === 0} onClick={() => go(i - 1)}><Icon name="back" size={18} /></button>
        <button className="fp-nav next" aria-label="Next slide" disabled={i === slides.length - 1} onClick={() => go(i + 1)}><Icon name="forward" size={18} /></button>
      </div>
      <div className="fp-bar">
        <span className="fp-count">{i + 1} / {slides.length}</span>
        <div className="fp-thumbs" ref={strip}>
          {slides.map((s, n) => (
            <button key={s} className={`fp-thumb ${n === i ? "is-on" : ""}`} onClick={() => go(n)} aria-label={`Slide ${n + 1}`}>
              <img src={s} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
        <button className="chip-btn" onClick={() => setPresenting(true)}>
          <Icon name="play" size={12} />
          Present
        </button>
      </div>
      {presenting && <Presenter slides={slides} start={i} name={name} onClose={(n) => { setI(n); setPresenting(false); }} />}
    </div>
  );
}

function Presenter({ slides, start, name, onClose }: { slides: string[]; start: number; name: string; onClose: (i: number) => void }) {
  const [i, setI] = useState(start);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); setI((v) => Math.min(slides.length - 1, v + 1)); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(slides.length - 1);
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(i); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [slides.length, onClose, i]);
  return createPortal(
    <div className="presenter" onClick={(e) => { if (e.target === e.currentTarget) setI((v) => Math.min(slides.length - 1, v + 1)); }}>
      <img src={slides[i]} alt={`${name}, slide ${i + 1}`} draggable={false} onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))} />
      <div className="presenter-bar">
        <span>{i + 1} / {slides.length}</span>
        <button onClick={() => onClose(i)} aria-label="Exit presentation"><Icon name="close" size={16} /></button>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sheets (xlsx, xls, ods, csv): parsed in the page with SheetJS
// ---------------------------------------------------------------------------

const MAX_ROWS = 2000;
const MAX_COLS = 60;

function colName(n: number) {
  let s = "";
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function SheetViewer({ url, name }: { url: string; name: string }) {
  const [book, setBook] = useState<{ names: string[]; sheets: Record<string, unknown[][]> } | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const buf = await (await fetch(url)).arrayBuffer();
        const wb = /\.(csv|tsv)$/i.test(name)
          ? XLSX.read(new TextDecoder().decode(buf), { type: "string", FS: /\.tsv$/i.test(name) ? "\t" : undefined })
          : XLSX.read(buf, { type: "array", cellDates: true });
        const sheets: Record<string, unknown[][]> = {};
        for (const n of wb.SheetNames) {
          sheets[n] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: "", blankrows: true });
        }
        if (!cancelled) setBook({ names: wb.SheetNames, sheets });
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, name]);

  const rows = useMemo(() => (book ? book.sheets[book.names[active]] ?? [] : []), [book, active]);
  const cols = useMemo(() => Math.min(MAX_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0)), [rows]);

  if (error) return <div className="fp-state"><Icon name="warning" size={16} /><span>Could not read this sheet: {error}</span></div>;
  if (!book) return <div className="fp-state"><Spinner size={15} /><span>Reading sheet</span></div>;
  return (
    <div className="fp-sheet">
      <div className="fp-sheet-scroll scroll">
        {rows.length === 0 ? (
          <div className="fp-state">This sheet is empty.</div>
        ) : (
          <table className="fp-grid">
            <thead>
              <tr>
                <th className="fp-corner" />
                {Array.from({ length: cols }, (_, c) => <th key={c}>{colName(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_ROWS).map((r, ri) => (
                <tr key={ri}>
                  <th className="fp-rownum">{ri + 1}</th>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} dir="auto">{String(r[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="fp-sheet-tabs">
        {book.names.map((n, i) => (
          <button key={n} className={`fp-sheet-tab ${i === active ? "is-on" : ""}`} onClick={() => setActive(i)}>
            <span className="bidi">{n}</span>
          </button>
        ))}
        {rows.length > MAX_ROWS && <span className="fp-note">Showing the first {MAX_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word (.docx): rendered in the page with docx-preview
// ---------------------------------------------------------------------------

function DocxViewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        const blob = await (await fetch(url)).blob();
        if (cancelled || !host.current) return;
        host.current.innerHTML = "";
        await renderAsync(blob, host.current, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (!cancelled) setState("ready");
      } catch (e) {
        if (!cancelled) setState(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div className="fp-docx scroll">
      {state === "loading" && <div className="fp-state"><Spinner size={15} /><span>Reading document</span></div>}
      {state !== "loading" && state !== "ready" && <div className="fp-state"><Icon name="warning" size={16} /><span>Could not read this document: {state}</span></div>}
      <div ref={host} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text and code
// ---------------------------------------------------------------------------

const MAX_TEXT = 400 * 1024;

function TextViewer({ url, size }: { url: string; size: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(url, size > MAX_TEXT ? { headers: { Range: `bytes=0-${MAX_TEXT - 1}` } } : undefined)
      .then((r) => r.text())
      .then(setText)
      .catch((e) => setText(`Could not read this file: ${errorMessage(e)}`));
  }, [url, size]);
  if (text === null) return <div className="fp-state"><Spinner size={15} /><span>Reading file</span></div>;
  const lines = text.split("\n");
  return (
    <div className="fp-text scroll">
      <pre>
        {lines.map((l, n) => (
          <div key={n} className="fp-line">
            <span className="fp-ln">{n + 1}</span>
            <span className="fp-lt" dir="auto">{l || " "}</span>
          </div>
        ))}
      </pre>
      {size > MAX_TEXT && <div className="fp-note">Showing the first 400 KB</div>}
    </div>
  );
}
