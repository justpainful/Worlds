/**
 * Claude in the text: select words, pick what to do with them, see the
 * change word by word, then keep it or not. Nothing on the page changes
 * until Accept.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { api, errorMessage } from "../lib/api";
import { emit } from "../lib/bus";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon, type IconName } from "../ui/Icon";

export const INLINE_ACTIONS: { id: string; label: string; icon: IconName; instruction: string; lookup?: boolean }[] = [
  {
    id: "define",
    label: "Meaning and synonyms",
    icon: "dictionary",
    lookup: true,
    instruction:
      "Explain the meaning of this word or phrase in one or two short lines, then list up to six synonyms and, if useful, one opposite. Answer in the same language as the text, and add the English meaning when the text is Arabic. Plain text only.",
  },
  { id: "improve", label: "Improve writing", icon: "assistant", instruction: "Improve the writing: clearer, more natural, same meaning and length. Keep the language." },
  { id: "fix", label: "Fix spelling and grammar", icon: "spellcheck", instruction: "Fix spelling, grammar and punctuation only. Change nothing else. Keep the language. In Arabic, fix hamzas, taa marbuta and alif maqsura." },
  { id: "shorter", label: "Make shorter", icon: "minimize", instruction: "Make it shorter while keeping every important point. Keep the language." },
  { id: "longer", label: "Make longer", icon: "expand", instruction: "Expand it with useful detail in the same voice. Keep the language." },
  { id: "simpler", label: "Simpler words", icon: "text", instruction: "Rewrite it in simpler, plainer words. Keep the language." },
  { id: "formal", label: "More formal", icon: "quote", instruction: "Rewrite it in a more formal, professional tone. Keep the language." },
  { id: "ar", label: "Translate to Arabic", icon: "translate", instruction: "Translate it into clear Modern Standard Arabic. Output only the translation." },
  { id: "en", label: "Translate to English", icon: "translate", instruction: "Translate it into natural English. Output only the translation." },
  { id: "summary", label: "Summarize", icon: "listView", instruction: "Summarize it in a few short sentences in the same language." },
  { id: "continue", label: "Continue writing", icon: "edit", instruction: "Return the text unchanged, then continue it with one or two more paragraphs in the same voice and language." },
];

type Piece = { kind: "same" | "add" | "del"; text: string };

/** Word-level difference between two texts (LCS over words and spaces). */
export function wordDiff(a: string, b: string): Piece[] {
  const split = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
  const x = split(a);
  const y = split(b);
  if (x.length * y.length > 4_000_000) return [{ kind: "del", text: a }, { kind: "add", text: b }];
  const dp: Uint32Array[] = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Piece[] = [];
  const push = (kind: Piece["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("add", y[j++]);
  }
  while (i < x.length) push("del", x[i++]);
  while (j < y.length) push("add", y[j++]);
  return out;
}

function Panel({ editor, pageId, from, to, text, rect, close, initial }: { editor: Editor; pageId: string; from: number; to: number; text: string; rect: DOMRect; close: () => void; initial?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [lookup, setLookup] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const run = async (instruction: string, isLookup = INLINE_ACTIONS.some((a) => a.instruction === instruction && a.lookup)) => {
    setLookup(isLookup);
    setBusy(true);
    setError(null);
    setResult(null);
    setLast(instruction);
    try {
      const out = await api.aiRewrite(text, isLookup ? instruction : `${instruction}\nThe text is part of a page; return only the rewritten text, as plain paragraphs.`);
      setResult(out.trim());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initial) void run(initial);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !busy && close();
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = () => {
    if (result === null) return;
    const paras = result.split(/\n{2,}|\n/).filter((p) => p.trim().length);
    const content = paras.length > 1 ? paras.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) : paras[0] ?? "";
    editor.chain().focus().insertContentAt({ from, to }, content).run();
    close();
  };

  const width = Math.min(460, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const below = rect.bottom + 8 + 320 < window.innerHeight;
  const style = below ? { left, top: rect.bottom + 8, width } : { left, bottom: window.innerHeight - rect.top + 8, width };

  return (
    <div className="inline-claude" ref={box} style={style} dir={uiLanguage() === "ar" ? "rtl" : "ltr"} role="dialog" aria-label={tr("Claude in the text")}>
      {result === null && !busy && (
        <>
          <form
            className="ic-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (ask.trim()) void run(ask.trim());
            }}
          >
            <Icon name="assistant" size={15} />
            <input className="bidi" dir="auto" autoFocus value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={tr("Tell Claude what to change")} />
            <button type="submit" className="ic-send" disabled={!ask.trim()} aria-label={tr("Send")}>
              <Icon name="arrowUp" size={14} />
            </button>
          </form>
          <div className="ic-actions">
            {INLINE_ACTIONS.map((a) => (
              <button key={a.id} className="ic-action" onClick={() => run(a.instruction)}>
                <Icon name={a.icon} size={14} />
                {tr(a.label)}
              </button>
            ))}
            <button
              className="ic-action"
              onClick={() => {
                emit("ai:open", { pageId, prompt: `Regarding this part of the page:\n"""\n${text}\n"""\n` });
                close();
              }}
            >
              <Icon name="external" size={14} />
              {tr("Ask in the chat")}
            </button>
          </div>
        </>
      )}
      {busy && (
        <div className="ic-busy">
          <Icon name="loading" size={15} />
          {tr("Claude is writing")}
        </div>
      )}
      {error && <div className="ic-error">{error}</div>}
      {result !== null && lookup && (
        <>
          <div className="ic-lookup bidi" dir="auto">
            {result}
          </div>
          <div className="ic-foot">
            <button className="btn btn-plain btn-compact" onClick={() => navigator.clipboard.writeText(result)}>
              <Icon name="duplicate" size={13} />
              {tr("Copy")}
            </button>
            <button className="btn btn-tinted btn-compact" onClick={close}>
              {tr("Done")}
            </button>
          </div>
        </>
      )}
      {result !== null && !lookup && (
        <>
          <div className="ic-diff bidi" dir="auto">
            {wordDiff(text, result).map((p, i) => (
              <span key={i} className={`ic-${p.kind}`}>
                {p.text}
              </span>
            ))}
          </div>
          <div className="ic-foot">
            <button className="btn btn-plain btn-compact" onClick={close}>
              {tr("Discard")}
            </button>
            <button className="btn btn-plain btn-compact" onClick={() => last && run(last)}>
              <Icon name="refresh" size={13} />
              {tr("Try again")}
            </button>
            <button className="btn btn-tinted btn-compact" onClick={accept}>
              <Icon name="check" size={13} />
              {tr("Accept")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Open Claude for the current selection, optionally starting one action right away. */
export function openInlineClaude(editor: Editor, pageId: string, instruction?: string) {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const text = editor.state.doc.textBetween(from, to, "\n");
  const end = editor.view.coordsAtPos(to);
  const start = editor.view.coordsAtPos(from);
  const rect = new DOMRect(Math.min(start.left, end.left), start.top, Math.abs(end.right - start.left), end.bottom - start.top);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Panel editor={editor} pageId={pageId} from={from} to={to} text={text} rect={rect} close={close} initial={instruction} />);
}
