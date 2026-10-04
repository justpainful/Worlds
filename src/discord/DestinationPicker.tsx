import { useMemo, useState } from "react";
import { SearchField } from "../ui/SearchField";
import type { Destination, DiscordInventory } from "../lib/types";
import { Segmented } from "../ui/Segmented";
import { Icon } from "../ui/Icon";
import { EmptyState } from "../ui/misc";
import { LAYER } from "../glass/materials";

type Kind = "channel" | "thread" | "dm";

/** Channel / thread / DM picker backed by what the bridge reports it can see. */
export function DestinationPicker({ inventory, value, onChange }: { inventory: DiscordInventory | null; value: Destination | null; onChange: (d: Destination) => void }) {
  const [kind, setKind] = useState<Kind>((value?.kind as Kind) === "thread" || value?.kind === "dm" ? (value!.kind as Kind) : "channel");
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");

  const entries = useMemo(() => {
    if (!inventory) return [];
    const ql = q.toLowerCase();
    const out: { id: string; label: string; sub: string; guildId?: string; canSend: boolean }[] = [];
    for (const g of inventory.guilds ?? []) {
      if (kind === "channel") {
        for (const c of g.channels ?? []) {
          if (![0, 5].includes(c.type)) continue; // text + announcement
          if (ql && !c.name.toLowerCase().includes(ql)) continue;
          out.push({ id: c.id, label: `#${c.name}`, sub: g.name, guildId: g.id, canSend: c.canSend !== false });
        }
      } else if (kind === "thread") {
        for (const t of g.threads ?? []) {
          if (ql && !t.name.toLowerCase().includes(ql)) continue;
          out.push({ id: t.id, label: t.name, sub: g.name, guildId: g.id, canSend: t.canSend !== false });
        }
      }
    }
    if (kind === "dm") {
      for (const u of inventory.users ?? []) {
        if (ql && !u.name.toLowerCase().includes(ql)) continue;
        out.push({ id: u.id, label: u.name, sub: "Direct message", canSend: true });
      }
    }
    return out.slice(0, 200);
  }, [inventory, kind, q]);

  return (
    <div className="dest-picker">
      <Segmented
        value={kind}
        onChange={(k) => setKind(k)}
        layer={LAYER.modal + 0.2}
        label="Destination type"
        options={[
          { value: "channel", label: "Channel" },
          { value: "thread", label: "Thread" },
          { value: "dm", label: "DM" },
        ]}
      />
      <SearchField size="compact" placeholder={kind === "dm" ? "Find a person" : "Find a channel"} value={q} onChange={setQ} />
      {inventory?.stale && (
        <div className="warn warn-warn">
          <Icon name="warning" size={13} />
          <span>Showing the last known list. The bridge is not reachable right now.</span>
        </div>
      )}
      <div className="dest-list scroll">
        {entries.length === 0 ? (
          <EmptyState compact icon={kind === "dm" ? "dm" : "channel"} title={kind === "dm" ? "No known people" : kind === "thread" ? "No active threads" : "No channels"} text={inventory ? "The bot reported none it can post to." : "Connect the Discord bridge to list destinations."} />
        ) : (
          entries.map((e) => {
            const selected = value?.id === e.id && value.kind === kind;
            return (
              <button
                key={e.id}
                className={`dest-row ${selected ? "is-selected" : ""}`}
                disabled={!e.canSend}
                onClick={() => onChange({ kind, id: e.id, label: e.label, guildId: e.guildId })}
              >
                <Icon name={kind === "dm" ? "user" : kind === "thread" ? "dm" : "channel"} size={14} />
                <span className="dest-label isolate" dir="auto">{e.label.replace(/^#/, "")}</span>
                <span className="dest-sub isolate" dir="auto">{e.canSend ? e.sub : "No permission to send"}</span>
                {selected && <Icon name="check" size={14} className="dest-check" />}
              </button>
            );
          })
        )}
      </div>
      <details className="dest-manual">
        <summary>Use an ID</summary>
        <div className="dest-manual-row">
          <input dir="ltr" className="field" placeholder={`${kind === "dm" ? "User" : kind === "thread" ? "Thread" : "Channel"} ID`} value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))} />
          <button className="chip-btn" disabled={manual.length < 15} onClick={() => onChange({ kind, id: manual, label: manual })}>Use</button>
        </div>
      </details>
    </div>
  );
}
