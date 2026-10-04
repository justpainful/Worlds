import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { emit } from "../../lib/bus";

const TONES: { tone: string; label: string; icon: IconName }[] = [
  { tone: "note", label: "Note", icon: "callout" },
  { tone: "highlight", label: "Highlight", icon: "highlight" },
  { tone: "warning", label: "Warning", icon: "warning" },
  { tone: "success", label: "Success", icon: "success" },
];

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const tone = TONES.find((t) => t.tone === node.attrs.tone) ?? TONES[0];
  return (
    <NodeViewWrapper className={`callout tone-${tone.tone}`} data-callout={tone.tone} dir={node.attrs.dir ?? "auto"}>
      <button
        className="callout-icon"
        contentEditable={false}
        aria-label="Change callout style"
        disabled={!editor.isEditable}
        onClick={(e) =>
          menuAt(
            e.currentTarget,
            TONES.map((t) => ({ label: t.label, icon: t.icon, checked: t.tone === tone.tone, onSelect: () => updateAttributes({ tone: t.tone }) })),
          )
        }
      >
        <Icon name={tone.icon} size={16} />
      </button>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

export function PromptView({ node, editor }: ReactNodeViewProps) {
  const text = () => {
    const parts: string[] = [];
    node.forEach((child) => parts.push(child.textContent));
    return parts.join("\n").trim();
  };
  const pageId = (editor.storage as unknown as { worlds?: { pageId?: string } }).worlds?.pageId ?? null;
  return (
    <NodeViewWrapper className="prompt-block" dir={node.attrs.dir ?? "auto"}>
      <div className="prompt-head" contentEditable={false}>
        <Icon name="prompt" size={14} />
        <span className="prompt-label">Prompt</span>
        <span className="prompt-actions">
          <button className="chip-btn" onClick={() => navigator.clipboard.writeText(text())}>
            <Icon name="duplicate" size={13} />
            Copy
          </button>
          <button className="chip-btn is-accent" onClick={() => emit("ai:open", { pageId, prompt: text() })}>
            <Icon name="assistant" size={13} />
            Run with Claude
          </button>
        </span>
      </div>
      <NodeViewContent className="prompt-body" />
    </NodeViewWrapper>
  );
}
