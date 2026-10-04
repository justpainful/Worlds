import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { openExternal } from "../../lib/links";
import { api } from "../../lib/api";
import type { Automation } from "../../lib/types";
import { describeDestination, describeTrigger, STATUS_LABEL } from "../../lib/automationText";
import { useStore } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { relTime, formatDateTime } from "../../ui/misc";

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function EmbedView({ node, selected }: ReactNodeViewProps) {
  const url = node.attrs.url as string;
  return (
    <NodeViewWrapper className={`embed-card ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <span className="embed-icon">
        <Icon name="globe" size={18} />
      </span>
      <span className="embed-main">
        <span className="embed-title isolate">{node.attrs.title || host(url)}</span>
        <span className="embed-url isolate" dir="ltr">{url}</span>
      </span>
      <button className="chip-btn" onClick={() => openExternal(url)}>
        <Icon name="external" size={13} />
        Open
      </button>
    </NodeViewWrapper>
  );
}

export function DiscordMessageView({ node, selected }: ReactNodeViewProps) {
  const a = node.attrs;
  const m = (a.url as string).match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  return (
    <NodeViewWrapper className={`discord-ref ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <div className="discord-ref-head">
        <Icon name="discord" size={15} />
        <span className="discord-ref-author bidi">{a.author || "Discord message"}</span>
        {a.channel && <span className="discord-ref-channel isolate">#{a.channel}</span>}
        {a.timestamp && <span className="discord-ref-time">{formatDateTime(a.timestamp)}</span>}
        <span className="grow" />
        <button className="chip-btn" onClick={() => openExternal((a.url as string).replace("https://discord.com", "discord://discord.com"))}>
          <Icon name="external" size={13} />
          Open in Discord
        </button>
      </div>
      {a.content ? (
        <div className="discord-ref-body bidi" dir="auto">{a.content}</div>
      ) : (
        <div className="discord-ref-body is-empty">
          {m ? <>Message <bdi>{m[3]}</bdi> in channel <bdi>{m[2]}</bdi></> : "Message link"}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export function ScheduleView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const id = node.attrs.automationId as string | null;
  const [auto, setAuto] = useState<Automation | null | undefined>(undefined);
  const open = useStore((s) => s.open);

  useEffect(() => {
    if (!id) return setAuto(null);
    const load = () => api.automation(id).then(setAuto).catch(() => setAuto(null));
    load();
    const h = () => load();
    window.addEventListener("worlds:changed", h);
    return () => window.removeEventListener("worlds:changed", h);
  }, [id]);

  if (auto === undefined) return <NodeViewWrapper className="schedule-card is-loading" contentEditable={false} />;
  if (!auto) {
    return (
      <NodeViewWrapper className={`schedule-card is-missing ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
        <Icon name="schedule" size={18} />
        <span className="schedule-main">
          <span className="schedule-title">This schedule was removed</span>
        </span>
        <button className="chip-btn" onClick={() => deleteNode()}>Remove</button>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={`schedule-card ${selected ? "is-selected" : ""} ${auto.enabled ? "" : "is-paused"}`} data-drag-handle contentEditable={false}>
      <span className="schedule-icon">
        <Icon name="schedule" size={18} />
      </span>
      <span className="schedule-main">
        <span className="schedule-title bidi">{auto.name}</span>
        <span className="schedule-meta">
          <span>{describeTrigger(auto.spec.trigger)}</span>
          <span className="isolate">{describeDestination(auto.spec.destination)}</span>
          {auto.enabled && auto.nextRunAt ? <span>Next {relTime(auto.nextRunAt)}</span> : <span>Paused</span>}
          {auto.lastStatus && <span className={`status-dot status-${auto.lastStatus}`}>{STATUS_LABEL[auto.lastStatus]}</span>}
        </span>
      </span>
      <button className="chip-btn" onClick={() => open({ kind: "automations", automationId: auto.id }, "right")}>
        <Icon name="edit" size={13} />
        Edit
      </button>
    </NodeViewWrapper>
  );
}
