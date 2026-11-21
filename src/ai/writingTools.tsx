/**
 * Writing tools around a page: ask the whole workspace, read a page aloud,
 * translate it side by side, step through its versions, and a weekly
 * summary written by Claude. Each opens as its own sheet over the app.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { JSONContent } from "@tiptap/core";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { PageMeta, Version } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { PageIcon, relTime } from "../ui/misc";
import { MenuSelect } from "../ui/MenuSelect";

const toastError = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

function mount(render: (close: () => void) => ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<>{render(close)}</>);
  return close;
}

/** Plain text of a block's JSON. */
export function textOf(n: JSONContent | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "pageMention") return `@${n.attrs?.label ?? ""}`;
  if (n.type === "mathInline" || n.type === "mathBlock") return n.attrs?.latex ?? "";
  const inner = (n.content ?? []).map(textOf);
  const sep = ["bulletList", "orderedList", "taskList", "table", "tableRow", "columns", "column", "toggle", "synced", "blockquote", "callout"].includes(n.type ?? "") ? "\n" : "";
  return inner.join(sep);
}

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

// ---------------------------------------------------------------------------
// Ask your space
// ---------------------------------------------------------------------------

const STOP = new Set("the a an and or of to in on for with is are was were be what which who how when where why do does did my your our i me you it this that these those from about at by as ما ماذا من في على عن إلى الى هل كيف متى أين لماذا هذا هذه ذلك التي الذي و أو ثم لي عندي".split(" "));

async function gatherSources(question: string, limit = 6) {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const score = new Map<string, { hits: number; title: string; icon: string | null }>();
  const queries = [question, ...words.slice(0, 8)];
  for (const q of queries) {
    try {
      for (const h of await api.search(q, 12, false)) {
        const s = score.get(h.pageId) ?? { hits: 0, title: h.title, icon: h.icon };
        s.hits += q === question ? 3 : 1;
        score.set(h.pageId, s);
      }
    } catch {
      /* one query failing is fine */
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, limit);
  const out: { id: string; title: string; icon: string | null; text: string }[] = [];
  for (const [id, s] of ranked) {
    try {
      const md = await api.pageMarkdown(id);
      out.push({ id, title: s.title, icon: s.icon, text: md.slice(0, 6000) });
    } catch {
      /* skip pages that cannot be read */
    }
  }
  return out;
}

function AskSpace({ close }: { close: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const question = q.trim();
    if (!question) return;
    setError(null);
    setAnswer(null);
    setBusy(tr("Looking through your pages"));
    try {
      const found = await gatherSources(question);
      setSources(found);
      if (!found.length) {
        setAnswer(tr("Nothing in your pages matches this question yet."));
        return;
      }
      setBusy(tr("Claude is reading them"));
      const context = found.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join("\n\n---\n\n");
      const out = await api.aiRewrite(
        context,
        `Answer this question using only the numbered sources from the person's own pages: "${question}". ` +
          "Cite the sources inline as [1], [2]. If the sources do not answer it, say so plainly. " +
          "Answer in the language of the question. Be concise. Output only the answer.",
      );
      setAnswer(out.trim());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const open = (id: string) => {
    useStore.getState().openPage(id);
    close();
  };

  // [n] in the answer becomes a link to that source.
  const rendered = useMemo(() => {
    if (!answer) return null;
    return answer.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      const s = m ? sources[Number(m[1]) - 1] : null;
      return s ? (
        <button key={i} className="ask-cite" onClick={() => open(s.id)} data-tip={s.title}>
          {m![1]}
        </button>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, sources]);

  return (
    <Modal title={tr("Ask your space")} onClose={close} width={620} className="ask-space">
      <form
        className="ask-field"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <Icon name="search" size={16} />
        <input className="bidi" dir="auto" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Ask anything about your pages")} />
        <button type="submit" className="btn btn-tinted btn-compact" disabled={!q.trim() || !!busy}>
          {tr("Ask")}
        </button>
      </form>
      {busy && (
        <div className="ask-busy">
          <Icon name="loading" size={15} />
          {busy}
        </div>
      )}
      {error && <div className="ask-error">{error}</div>}
      {answer && (
        <div className="ask-answer bidi" dir="auto">
          {rendered}
        </div>
      )}
      {sources.length > 0 && !busy && (
        <div className="ask-sources">
          <div className="ask-sources-title">{tr("Sources")}</div>
          {sources.map((s, i) => (
            <button key={s.id} className="ask-source" onClick={() => open(s.id)}>
              <span className="ask-source-n">{i + 1}</span>
              <PageIcon icon={s.icon} size={15} />
              <span className="bidi">{s.title || tr("Untitled")}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export const openAskSpace = () => mount((close) => <AskSpace close={close} />);

// ---------------------------------------------------------------------------
// Read aloud
// ---------------------------------------------------------------------------

type Sentence = { range: Range; text: string };

function sentencesIn(root: HTMLElement): Sentence[] {
  const out: Sentence[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[contenteditable=false], .code-run, .whiteboard, .form-block, button, sup") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    const re = /[^.!?؟\n]+[.!?؟]*/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].trim()) continue;
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      out.push({ range: r, text: m[0].trim() });
    }
  }
  return out;
}

let reading: { stop: () => void } | null = null;

function ReadAloud({ root, close }: { root: HTMLElement; close: () => void }) {
  const sentences = useMemo(() => sentencesIn(root), [root]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const index = useRef(0);
  const synth = window.speechSynthesis;
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

  const speak = (k: number) => {
    synth.cancel();
    if (k >= sentences.length) {
      setPlaying(false);
      highlights?.delete("read-aloud");
      return;
    }
    index.current = k;
    setI(k);
    const s = sentences[k];
    if (highlights && HighlightCtor) highlights.set("read-aloud", new HighlightCtor(s.range));
    s.range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = isArabic(s.text) ? "ar-SA" : "en-US";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => {
      if (index.current === k) speak(k + 1);
    };
    synth.speak(u);
  };

  useEffect(() => {
    reading = { stop: close };
    if (sentences.length) speak(0);
    return () => {
      synth.cancel();
      highlights?.delete("read-aloud");
      if (reading?.stop === close) reading = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (playing) {
      synth.pause();
      setPlaying(false);
    } else {
      if (synth.paused) synth.resume();
      else speak(index.current);
      setPlaying(true);
    }
  };

  return (
    <div className="read-aloud" role="region" aria-label={tr("Read aloud")} dir={uiLanguage() === "ar" ? "rtl" : "ltr"}>
      <button className="ra-btn" aria-label={tr("Previous sentence")} onClick={() => speak(Math.max(0, index.current - 1))}>
        <Icon name="back" size={15} />
      </button>
      <button className="ra-btn ra-main" aria-label={playing ? tr("Pause") : tr("Play")} onClick={toggle}>
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <button className="ra-btn" aria-label={tr("Next sentence")} onClick={() => speak(index.current + 1)}>
        <Icon name="forward" size={15} />
      </button>
      <span className="ra-count">{sentences.length ? `${i + 1} / ${sentences.length}` : tr("Nothing to read")}</span>
      <MenuSelect
        value={String(rate)}
        aria-label={tr("Speed")}
        onChange={(e) => {
          setRate(Number(e.target.value));
          requestAnimationFrame(() => speak(index.current));
        }}
      >
        {[0.75, 1, 1.25, 1.5, 2].map((r) => (
          <option key={r} value={String(r)}>
            {`${r}x`}
          </option>
        ))}
      </MenuSelect>
      <button className="ra-btn" aria-label={tr("Stop")} onClick={close}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

/** Read the open page aloud, sentence by sentence, with the current one highlighted. */
export function readAloud() {
  reading?.stop();
  const root = (document.querySelector(".pane.is-active .ProseMirror") ?? document.querySelector(".ProseMirror")) as HTMLElement | null;
  if (!root) return useStore.getState().toast({ message: tr("Open a page to read it aloud") });
  if (!("speechSynthesis" in window)) return useStore.getState().toast({ message: tr("This device cannot read text aloud"), tone: "error" });
  mount((close) => <ReadAloud root={root} close={close} />);
}

// ---------------------------------------------------------------------------
// Translation side by side
// ---------------------------------------------------------------------------

const LANGS = [
  { id: "Arabic", label: "العربية" },
  { id: "English", label: "English" },
  { id: "French", label: "Français" },
  { id: "Spanish", label: "Español" },
  { id: "Turkish", label: "Türkçe" },
  { id: "Urdu", label: "اردو" },
];

function SideBySide({ pageId, close }: { pageId: string; close: () => void }) {
  const [rows, setRows] = useState<{ type: string; level?: number; text: string }[]>([]);
  const [out, setOut] = useState<string[] | null>(null);
  const [lang, setLang] = useState(() => "Arabic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = pageTitle(useStore.getState().pages[pageId]);

  useEffect(() => {
    api
      .page(pageId)
      .then((p) => {
        const list = (p?.blocks ?? [])
          .map((b) => ({ type: b.content.type ?? "paragraph", level: b.content.attrs?.level as number | undefined, text: textOf(b.content).trim() }))
          .filter((r) => r.text);
        setRows(list);
        setLang(list.some((r) => isArabic(r.text)) ? "English" : "Arabic");
      })
      .catch(toastError);
  }, [pageId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const res = await api.aiRewrite(
        JSON.stringify(rows.map((r) => r.text)),
        `Translate every string in this JSON array into ${lang}. Return ONLY a JSON array of strings of exactly the same length and order. Keep names, numbers and formatting.`,
      );
      const json = res.slice(res.indexOf("["), res.lastIndexOf("]") + 1);
      const arr = JSON.parse(json) as unknown[];
      setOut(rows.map((_, i) => String(arr[i] ?? "")));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!out) return;
    try {
      const meta = await api.createPage({ title: `${title} (${LANGS.find((l) => l.id === lang)?.label ?? lang})`, parentId: useStore.getState().pages[pageId]?.parentId ?? null } as never);
      const md = rows.map((r, i) => (r.type === "heading" ? `${"#".repeat(r.level ?? 2)} ${out[i]}` : out[i])).join("\n\n");
      await api.pageAppendMarkdown(meta.id, md);
      await useStore.getState().refreshPages();
      useStore.getState().openPage(meta.id);
      close();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal title={`${tr("Side by side")}: ${title}`} onClose={close} width={980} className="side-by-side">
      <div className="sbs-bar">
        <span>{tr("Translate into")}</span>
        <MenuSelect value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </MenuSelect>
        <button className="btn btn-tinted btn-compact" onClick={run} disabled={busy || !rows.length}>
          <Icon name={busy ? "loading" : "translate"} size={14} />
          {busy ? tr("Translating") : tr("Translate")}
        </button>
        <span className="grow" />
        {out && (
          <button className="btn btn-plain btn-compact" onClick={save}>
            <Icon name="add" size={14} />
            {tr("Save as a new page")}
          </button>
        )}
      </div>
      {error && <div className="ask-error">{error}</div>}
      <div className="sbs-grid">
        {rows.map((r, i) => (
          <Fragment key={i}>
            <div className={`sbs-cell bidi is-${r.type}`} dir="auto">
              {r.text}
            </div>
            <div className={`sbs-cell bidi is-${r.type} ${out ? "" : "is-waiting"}`} dir="auto">
              {out ? out[i] : ""}
            </div>
          </Fragment>
        ))}
        {!rows.length && <p className="sbs-empty">{tr("This page has no text to translate.")}</p>}
      </div>
    </Modal>
  );
}

export const openSideBySide = (pageId: string) => mount((close) => <SideBySide pageId={pageId} close={close} />);

// ---------------------------------------------------------------------------
// Time machine
// ---------------------------------------------------------------------------

function Inline({ n }: { n: JSONContent }): ReactNode {
  if (n.type === "text") {
    let el: ReactNode = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "strike") el = <s>{el}</s>;
      else if (m.type === "code") el = <code>{el}</code>;
      else if (m.type === "underline") el = <u>{el}</u>;
    }
    return el;
  }
  if (n.type === "hardBreak") return <br />;
  if (n.type === "pageMention") return <span className="mention">@{n.attrs?.label}</span>;
  return <>{(n.content ?? []).map((c, i) => <Inline key={i} n={c} />)}</>;
}

function Block({ n }: { n: JSONContent }): ReactNode {
  const kids = (n.content ?? []).map((c, i) => <Block key={i} n={c} />);
  const inline = (n.content ?? []).map((c, i) => <Inline key={i} n={c} />);
  switch (n.type) {
    case "paragraph":
      return (
        <p className="bidi" dir="auto">
          {inline}
        </p>
      );
    case "heading": {
      const H = `h${Math.min(3, Number(n.attrs?.level ?? 2))}` as "h1" | "h2" | "h3";
      return (
        <H className="bidi" dir="auto">
          {inline}
        </H>
      );
    }
    case "bulletList":
      return <ul>{kids}</ul>;
    case "orderedList":
      return <ol>{kids}</ol>;
    case "taskList":
      return <ul className="tm-tasks">{kids}</ul>;
    case "listItem":
      return <li>{kids}</li>;
    case "taskItem":
      return (
        <li>
          <input type="checkbox" checked={!!n.attrs?.checked} readOnly /> {kids}
        </li>
      );
    case "blockquote":
      return <blockquote>{kids}</blockquote>;
    case "codeBlock":
      return <pre dir="ltr">{textOf(n)}</pre>;
    case "horizontalRule":
      return <hr />;
    case "image":
      return n.attrs?.attachmentId ? <img src={fileUrl(n.attrs.attachmentId)} alt="" /> : null;
    case "table":
      return (
        <table>
          <tbody>
            {(n.content ?? []).map((row, i) => (
              <tr key={i}>
                {(row.content ?? []).map((cell, j) => (
                  <td key={j} className="bidi" dir="auto">
                    {textOf(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "callout":
    case "toggle":
    case "column":
    case "columns":
    case "synced":
      return <div className={`tm-box tm-${n.type}`}>{kids}</div>;
    default: {
      const t = textOf(n).trim();
      return <div className="tm-other">{t || tr("A block without text")}</div>;
    }
  }
}

function TimeMachine({ pageId, close }: { pageId: string; close: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [at, setAt] = useState(0);
  const [snap, setSnap] = useState<{ title: string; blocks: JSONContent[] } | null>(null);
  const [prev, setPrev] = useState<JSONContent[] | null>(null);
  const cache = useRef(new Map<string, { title: string; blocks: JSONContent[] }>());

  useEffect(() => {
    api
      .versions(pageId)
      .then((v) => {
        const sorted = [...v].sort((a, b) => a.createdAt - b.createdAt);
        setVersions(sorted);
        setAt(sorted.length - 1);
      })
      .catch(toastError);
  }, [pageId]);

  const load = async (id: string) => {
    const hit = cache.current.get(id);
    if (hit) return hit;
    const v = await api.version(id);
    cache.current.set(id, v);
    return v;
  };

  useEffect(() => {
    const v = versions[at];
    if (!v) return;
    let alive = true;
    load(v.id)
      .then(async (s) => {
        const before = at > 0 ? await load(versions[at - 1].id) : null;
        if (!alive) return;
        setSnap(s);
        setPrev(before?.blocks ?? null);
      })
      .catch(toastError);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, versions]);

  const changed = useMemo(() => {
    if (!snap || !prev) return new Map<number, "add" | "change">();
    const old = new Map(prev.map((b) => [b.attrs?.bid, JSON.stringify(b)]));
    const m = new Map<number, "add" | "change">();
    snap.blocks.forEach((b, i) => {
      const was = old.get(b.attrs?.bid);
      if (was === undefined) m.set(i, "add");
      else if (was !== JSON.stringify(b)) m.set(i, "change");
    });
    return m;
  }, [snap, prev]);

  const v = versions[at];
  const restore = async () => {
    if (!v) return;
    try {
      await api.restoreVersion(v.id);
      useStore.getState().bumpExternal(pageId);
      useStore.getState().toast({ message: tr("The page is back to this version. Undo it from History if needed.") });
      close();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal title={tr("Time machine")} onClose={close} width={860} className="time-machine">
      {versions.length === 0 ? (
        <p className="tm-empty">{tr("This page has no saved versions yet. Worlds keeps one as you edit.")}</p>
      ) : (
        <>
          <div className="tm-bar">
            <input
              type="range"
              min={0}
              max={versions.length - 1}
              value={at}
              onChange={(e) => setAt(Number(e.target.value))}
              aria-label={tr("Version")}
              style={{ ["--fill" as string]: `${versions.length > 1 ? (at / (versions.length - 1)) * 100 : 100}%` }}
            />
            <span className="tm-when">
              {v ? new Date(v.createdAt).toLocaleString(uiLanguage() === "ar" ? "ar" : undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}
              {v ? ` · ${relTime(v.createdAt)}` : ""}
            </span>
            <span className="grow" />
            <span className="tm-legend">
              <i className="is-add" /> {tr("added")} <i className="is-change" /> {tr("changed")}
            </span>
            <button className="btn btn-tinted btn-compact" onClick={restore} disabled={!v}>
              <Icon name="restore" size={14} />
              {tr("Restore this version")}
            </button>
          </div>
          <div className="tm-doc">
            {snap && <h1 className="tm-title bidi">{snap.title}</h1>}
            {snap?.blocks.map((b, i) => (
              <div key={i} className={`tm-row ${changed.get(i) ? `is-${changed.get(i)}` : ""}`}>
                <Block n={b} />
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export const openTimeMachine = (pageId: string) => mount((close) => <TimeMachine pageId={pageId} close={close} />);

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

const SUMMARY_PARENT = "summary.parent";
const SUMMARY_LAST = "summary.last";

/** Write a page that sums up the last seven days of work, under "Weekly summaries". */
export async function weeklySummary(): Promise<string | null> {
  const s = useStore.getState();
  const since = Date.now() - 7 * 86400000;
  const recent = Object.values(s.pages)
    .filter((p: PageMeta) => !p.deletedAt && p.updatedAt >= since && p.kind !== "template")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!recent.length) {
    s.toast({ message: tr("Nothing changed this week, so there is nothing to sum up.") });
    return null;
  }
  s.toast({ message: tr("Claude is writing your weekly summary") });
  const parts: string[] = [];
  for (const p of recent.slice(0, 12)) {
    try {
      parts.push(`## ${pageTitle(p)}\n${(await api.pageMarkdown(p.id)).slice(0, 3000)}`);
    } catch {
      parts.push(`## ${pageTitle(p)}\n${p.preview}`);
    }
  }
  const others = recent
    .slice(12)
    .map((p) => `- ${pageTitle(p)}`)
    .join("\n");
  const arabic = uiLanguage() === "ar";
  const md = await api.aiRewrite(
    `${parts.join("\n\n")}${others ? `\n\nAlso edited:\n${others}` : ""}`,
    `Write a short weekly summary of this person's work from these pages they edited in the last seven days. ` +
      `Use headings "What I worked on", "Done", "Still open" and "Next week" (in ${arabic ? "Arabic" : "English"}), short bullet points, ` +
      `and mention page names. Output only Markdown.`,
  );
  let parent = (s.settings[SUMMARY_PARENT] as string | undefined) ?? null;
  if (!parent || !s.pages[parent] || s.pages[parent].deletedAt) {
    const holder = await api.createPage({ title: arabic ? "الملخصات الأسبوعية" : "Weekly summaries" } as never);
    parent = holder.id;
    s.setSetting(SUMMARY_PARENT, parent);
  }
  const day = new Date().toLocaleDateString(arabic ? "ar" : undefined, { day: "numeric", month: "long", year: "numeric" });
  const page = await api.createPage({ title: arabic ? `أسبوع ${day}` : `Week of ${day}`, parentId: parent } as never);
  await api.pageAppendMarkdown(page.id, md);
  s.setSetting(SUMMARY_LAST, Date.now());
  await s.refreshPages();
  return page.id;
}

/** On the chosen weekday, write the summary once if Settings asks for it. */
export function maybeWeeklySummary() {
  const s = useStore.getState();
  const day = s.settings["summary.weekday"];
  if (typeof day !== "number" || day < 0) return;
  const last = (s.settings[SUMMARY_LAST] as number | undefined) ?? 0;
  if (new Date().getDay() !== day || Date.now() - last < 5 * 86400000) return;
  weeklySummary().catch(() => undefined);
}
