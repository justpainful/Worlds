/** A pack kind as a board: one lane per stage, cards dragged between lanes. */
import { useState } from "react";
import type { PageMeta } from "../../lib/types";
import { pageTitle, useStore } from "../../state/store";
import { IconButton } from "../../ui/Button";
import type { KindDef, PackDef } from "../definition";
import { formatField, listFields } from "../fields";
import { createPackItem, itemData, updatePackItem } from "../items";

const DRAG = "application/x-worlds-pack-item";

export function PackBoard({ pack, kind, items, groupBy }: { pack: PackDef; kind: KindDef; items: PageMeta[]; groupBy: string }) {
  const openPage = useStore((s) => s.openPage);
  const field = kind.fields.find((f) => f.id === groupBy);
  const [over, setOver] = useState<string | null>(null);
  if (!field?.options?.length) return null;
  // A choice can be empty; a stage always has one.
  const lanes = [...field.options, ...(field.type === "choice" ? [{ id: "", label: "None", color: undefined }] : [])];
  const shown = listFields(kind).filter((f) => f.id !== field.id).slice(0, 2);
  const laneOf = (p: PageMeta) => {
    const v = itemData(p)[field.id];
    return typeof v === "string" && field.options!.some((o) => o.id === v) ? v : field.type === "stage" ? field.options![0].id : "";
  };
  const drop = (lane: string, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG);
    const p = items.find((x) => x.id === id);
    if (p && laneOf(p) !== lane) void updatePackItem(p, { [field.id]: lane || null });
  };

  return (
    <div className="pk-board">
      {lanes.map((lane) => {
        const cards = items.filter((p) => laneOf(p) === lane.id);
        return (
          <section
            key={lane.id || "none"}
            className={`pk-lane ${over === lane.id ? "is-over" : ""}`}
            data-color={lane.color}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG)) return;
              e.preventDefault();
              setOver(lane.id);
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => drop(lane.id, e)}
          >
            <header className="pk-lane-head">
              <span className="pk-lane-title">{lane.label}</span>
              <span className="pl-count">{cards.length}</span>
              <IconButton
                icon="add"
                label={`Add ${kind.label.toLowerCase()}`}
                onClick={() => void createPackItem(pack, kind, { data: lane.id ? { [field.id]: lane.id } : {}, open: "current" })}
              />
            </header>
            <div className="pk-cards">
              {cards.map((p) => {
                const data = itemData(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="pk-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG, p.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : "current")}
                  >
                    <span className="pk-card-title bidi">{pageTitle(p)}</span>
                    {shown.map((f) => {
                      const v = formatField(f, data[f.id]);
                      return v ? (
                        <span key={f.id} className="pk-card-field">
                          <span className="pk-card-label">{f.label}</span> <span className="bidi">{v}</span>
                        </span>
                      ) : null;
                    })}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
