import type { ReactNode } from "react";
import { fileUrl } from "../lib/api";
import type { DiscordComponent, Rendered } from "../lib/types";
import { useStore } from "../state/store";
import { Icon } from "../ui/Icon";
import { formatBytes } from "../ui/misc";
import { BRIDGE } from "./bridge";

/**
 * Renders the exact Components V2 payload Worlds will hand to the bridge, in a
 * Discord-like presentation. Lines resolve their own direction the way
 * Discord's client does, so bidi problems show up here before sending.
 */
export function DiscordPreview({ rendered, mobile, compact, botName = BRIDGE.name }: { rendered: Rendered; mobile?: boolean; compact?: boolean; botName?: string }) {
  const files = new Map(rendered.files.map((f) => [`attachment://${f.name}`, f]));
  return (
    <div className={`dc-preview ${mobile ? "is-mobile" : ""} ${compact ? "is-compact" : ""}`}>
      <div className="dc-message">
        <div className="dc-avatar">
          <Icon name="discord" size={18} />
        </div>
        <div className="dc-body">
          <div className="dc-head">
            <span className="dc-name">{botName}</span>
            <span className="dc-app">APP</span>
            <span className="dc-time">Today at {new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <div className="dc-components">{rendered.payload.components.map((c, i) => renderComponent(c, i, files))}</div>
        </div>
      </div>
    </div>
  );
}

type FileMap = Map<string, { attachmentId: string; name: string; size: number }>;

function renderComponent(c: DiscordComponent, key: number, files: FileMap): ReactNode {
  switch (c.type) {
    case 17: {
      const accent = typeof c.accent_color === "number" ? `#${(c.accent_color as number).toString(16).padStart(6, "0")}` : undefined;
      return (
        <div key={key} className={`dc-container ${accent ? "has-accent" : ""}`} style={accent ? { ["--dc-accent" as string]: accent } : undefined}>
          {(c.components as DiscordComponent[]).map((x, i) => renderComponent(x, i, files))}
        </div>
      );
    }
    case 10:
      return <div key={key} className="dc-text">{markdown(c.content as string)}</div>;
    case 14:
      return <div key={key} className={`dc-sep ${c.divider === false ? "is-space" : ""}`} />;
    case 12: {
      const items = c.items as { media: { url: string }; description?: string }[];
      return (
        <div key={key} className={`dc-gallery n${Math.min(items.length, 4)}`}>
          {items.map((it, i) => {
            const f = files.get(it.media.url);
            return f ? <img key={i} src={fileUrl(f.attachmentId)} alt={it.description ?? ""} crossOrigin="anonymous" /> : <div key={i} className="dc-gallery-missing" />;
          })}
        </div>
      );
    }
    case 13: {
      const f = files.get((c.file as { url: string }).url);
      return (
        <div key={key} className="dc-file">
          <Icon name="file" size={22} />
          <div>
            <div className="dc-file-name">{f?.name ?? "file"}</div>
            <div className="dc-file-size">{f ? formatBytes(f.size) : ""}</div>
          </div>
        </div>
      );
    }
    case 1:
      return (
        <div key={key} className="dc-actions">
          {(c.components as DiscordComponent[]).map((b, i) => (
            <span key={i} className={`dc-button style-${b.style}`}>
              <span className="bidi">{b.label as string}</span>
              {b.style === 5 && <Icon name="external" size={13} />}
            </span>
          ))}
        </div>
      );
    case 9:
      return (
        <div key={key} className="dc-section">
          <div>{(c.components as DiscordComponent[]).map((x, i) => renderComponent(x, i, files))}</div>
          {c.accessory ? renderComponent(c.accessory as DiscordComponent, 99, files) : null}
        </div>
      );
    default:
      return null;
  }
}

/** Minimal Discord markdown: headings, subtext, quotes, lists, code, inline styles, links. */
function markdown(src: string): ReactNode {
  const lines = src.split("\n");
  const out: ReactNode[] = [];
  let code: string[] | null = null;
  lines.forEach((raw, i) => {
    if (raw.trimStart().startsWith("```")) {
      if (code) {
        out.push(<pre key={`c${i}`} className="dc-code" dir="ltr">{code.join("\n")}</pre>);
        code = null;
      } else code = [];
      return;
    }
    if (code) {
      code.push(raw);
      return;
    }
    let line = raw;
    let cls = "dc-line";
    let quote = false;
    if (line.startsWith("> ")) {
      quote = true;
      line = line.slice(2);
    }
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) {
      cls += ` dc-h${h[1].length}`;
      line = h[2];
    } else if (line.startsWith("-# ")) {
      cls += " dc-subtext";
      line = line.slice(3);
    }
    const li = line.match(/^(\s*)(- |\d+\. )(.*)$/);
    let bullet: ReactNode = null;
    if (li && !h) {
      bullet = <span className="dc-bullet">{li[2].trim() === "-" ? "•" : li[2].trim()}</span>;
      line = li[3];
      cls += " dc-li";
    }
    const content = line.trim() === "" ? <br /> : inlineMd(line);
    out.push(
      <div key={i} className={`${cls} ${quote ? "dc-quote" : ""}`}>
        {bullet}
        <span className="dc-line-text">{content}</span>
      </div>,
    );
  });
  return out;
}

function inlineMd(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(unescape(s.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{inlineMd(t.slice(2, -2))}</strong>);
    else if (t.startsWith("__")) out.push(<u key={k++}>{inlineMd(t.slice(2, -2))}</u>);
    else if (t.startsWith("~~")) out.push(<s key={k++}>{inlineMd(t.slice(2, -2))}</s>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="dc-inline-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const mm = t.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      out.push(<span key={k++} className="dc-link">{mm[1]}</span>);
    } else out.push(<em key={k++}>{inlineMd(t.slice(1, -1))}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(unescape(s.slice(last)));
  return out;
}

const unescape = (s: string) => s.replace(/\\([*_~|`])/g, "$1");

export function useBotName(): string {
  return (useStore((s) => (s.settings["discord.cache"] as { bot?: { tag?: string } } | undefined)?.bot?.tag) ?? BRIDGE.name).split("#")[0];
}
