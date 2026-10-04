import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { fileUrl } from "../lib/api";
import { resolveTitle } from "../editor/extensions/suggest";
import { Icon } from "../ui/Icon";

/** Read-only rendering of stored block JSON (version previews, change review). */
export function BlocksPreview({ blocks }: { blocks: JSONContent[] }) {
  return <div className="prose preview">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

function dirOf(n: JSONContent) {
  const d = n.attrs?.dir;
  return d === "rtl" || d === "ltr" ? d : "auto";
}

function inline(nodes: JSONContent[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    if (n.type === "pageMention") return <span key={i} className="mention" dir="auto">@{resolveTitle(n.attrs?.id, n.attrs?.label)}</span>;
    if (n.type !== "text") return <span key={i}>{inline(n.content)}</span>;
    let el: ReactNode = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "strike") el = <s>{el}</s>;
      else if (m.type === "code") el = <code>{el}</code>;
      else if (m.type === "highlight") el = <mark>{el}</mark>;
      else if (m.type === "link") el = <a className="link">{el}</a>;
    }
    return <span key={i}>{el}</span>;
  });
}

function renderBlock(n: JSONContent, key: number): ReactNode {
  const dir = dirOf(n);
  switch (n.type) {
    case "paragraph":
      return <p key={key} dir={dir}>{inline(n.content)}</p>;
    case "heading": {
      const L = `h${n.attrs?.level ?? 1}` as "h1";
      return <L key={key} dir={dir}>{inline(n.content)}</L>;
    }
    case "bulletList":
      return <ul key={key} dir={dir}>{(n.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map(renderBlock)}</li>)}</ul>;
    case "orderedList":
      return <ol key={key} dir={dir}>{(n.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map(renderBlock)}</li>)}</ol>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList" dir={dir}>
          {(n.content ?? []).map((li, i) => (
            <li key={i} data-checked={li.attrs?.checked ? "true" : "false"}>
              <label><input type="checkbox" checked={!!li.attrs?.checked} readOnly /></label>
              <div>{(li.content ?? []).map(renderBlock)}</div>
            </li>
          ))}
        </ul>
      );
    case "blockquote":
      return <blockquote key={key} dir={dir}>{(n.content ?? []).map(renderBlock)}</blockquote>;
    case "callout":
      return <div key={key} className={`callout tone-${n.attrs?.tone ?? "note"}`} dir={dir}><span className="callout-icon"><Icon name="callout" size={15} /></span><div className="callout-body">{(n.content ?? []).map(renderBlock)}</div></div>;
    case "prompt":
      return <div key={key} className="prompt-block" dir={dir}><div className="prompt-body">{(n.content ?? []).map(renderBlock)}</div></div>;
    case "codeBlock":
      return <pre key={key} className="code-block" dir="ltr"><code>{(n.content ?? []).map((t) => t.text).join("")}</code></pre>;
    case "horizontalRule":
      return <hr key={key} />;
    case "table":
      return (
        <table key={key} className="table">
          <tbody>
            {(n.content ?? []).map((row, r) => (
              <tr key={r}>
                {(row.content ?? []).map((cell, c) =>
                  cell.type === "tableHeader" ? <th key={c}>{(cell.content ?? []).map(renderBlock)}</th> : <td key={c}>{(cell.content ?? []).map(renderBlock)}</td>,
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      return n.attrs?.attachmentId ? <img key={key} className="preview-img" src={fileUrl(n.attrs.attachmentId)} alt="" crossOrigin="anonymous" /> : null;
    case "video":
      return <div key={key} className="preview-chip"><Icon name="video" size={14} /> {n.attrs?.name || "Video"}</div>;
    case "file":
      return <div key={key} className="preview-chip"><Icon name="file" size={14} /> <bdi>{n.attrs?.name || "File"}</bdi></div>;
    case "pageLink":
      return <div key={key} className="preview-chip"><Icon name="subpage" size={14} /> {resolveTitle(n.attrs?.pageId, n.attrs?.title)}</div>;
    case "embed":
      return <div key={key} className="preview-chip"><Icon name="link" size={14} /> <bdi>{n.attrs?.url}</bdi></div>;
    case "discordMessage":
      return <div key={key} className="preview-chip"><Icon name="discord" size={14} /> Discord message</div>;
    case "schedule":
      return <div key={key} className="preview-chip"><Icon name="schedule" size={14} /> Schedule</div>;
    default:
      return null;
  }
}
