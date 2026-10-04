import type { ReactNode } from "react";
import { openExternal } from "../lib/links";
import { useStore, pageTitle } from "../state/store";
import { Icon } from "../ui/Icon";

/**
 * Small Markdown renderer for Claude's answers: headings, lists, quotes,
 * fenced code, bold/italic/code/links, plus Worlds mentions:
 *   @[Title](page:ID)  → page chip (opens the page)
 *   #[Title](chat:ID)  → conversation chip
 * Every block resolves its own text direction.
 */
export function Markdown({ text, onOpenChat }: { text: string; onOpenChat?: (id: string) => void }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      const lang = t.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="md-code" dir="ltr" data-lang={lang || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (!t) {
      i++;
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const L = `h${Math.min(3, h[1].length) + 2}` as "h3";
      out.push(<L key={key++} className="md-h" dir="auto">{inline(h[2], onOpenChat)}</L>);
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const m = ordered ? l.match(/^\d+[.)]\s+(.*)$/) : l.match(/^[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key++} className="md-list" dir="auto">
          {items.map((it, n) => <li key={n}>{inline(it, onOpenChat)}</li>)}
        </List>,
      );
      continue;
    }
    if (t.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      out.push(<blockquote key={key++} className="md-quote" dir="auto">{inline(q.join(" "), onOpenChat)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|[-*]\s|\d+[.)]\s|>)/.test(lines[i].trim())) para.push(lines[i++]);
    out.push(
      <p key={key++} className="md-p" dir="auto">
        {para.map((p, n) => (
          <span key={n}>
            {n > 0 && <br />}
            {inline(p, onOpenChat)}
          </span>
        ))}
      </p>,
    );
  }
  return <div className="md">{out}</div>;
}

const INLINE = /(@\[[^\]]+\]\(page:[^)]+\)|#\[[^\]]+\]\(chat:[^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*)/g;

function inline(s: string, onOpenChat?: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of s.matchAll(INLINE)) {
    const t = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    if (t.startsWith("@[")) {
      const mm = t.match(/^@\[([^\]]+)\]\(page:([^)]+)\)$/)!;
      out.push(<PageChip key={k++} id={mm[2]} label={mm[1]} />);
    } else if (t.startsWith("#[")) {
      const mm = t.match(/^#\[([^\]]+)\]\(chat:([^)]+)\)$/)!;
      out.push(
        <button key={k++} className="chat-chip isolate" onClick={() => onOpenChat?.(mm[2])}>
          <Icon name="assistant" size={11} />
          {mm[1]}
        </button>,
      );
    } else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="md-icode">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const mm = t.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      out.push(
        <button key={k++} className="md-link" onClick={() => openExternal(mm[2])}>
          {mm[1]}
        </button>,
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = at + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function PageChip({ id, label }: { id: string; label: string }) {
  const page = useStore((s) => s.pages[id]);
  const openPage = useStore((s) => s.openPage);
  return (
    <button className="mention isolate" onClick={(e) => page && openPage(id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
      @{page ? pageTitle(page) : label}
    </button>
  );
}
