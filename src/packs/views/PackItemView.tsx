/** One pack item: its fields to edit, built from the kind's definition. */
import { trashItem } from "../../planning/actions";
import { Field } from "../../planning/ui";
import { ResourceHeader } from "../../resources/views/ResourceHeader";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/misc";
import { formatField } from "../fields";
import { itemData, updatePackItem } from "../items";
import { kindDefOf } from "../registry";
import { FieldInput } from "./FieldInput";

export function PackItemView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  const def = p ? kindDefOf(p.kind) : undefined;
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This item is not here any more" text="It may have been deleted." />;
  if (!def) return <EmptyState icon="warning" title="This item belongs to a pack Worlds does not have" text="It is kept as it is; a newer Worlds may open it." />;
  const { kind } = def;
  const data = itemData(p);
  const set = (fieldId: string, v: unknown) => void updatePackItem(p, { [fieldId]: v });
  const done = kind.doneField ? data[kind.doneField] === true : false;
  const stage = kind.stageField ? kind.fields.find((f) => f.id === kind.stageField) : undefined;
  const short = kind.fields.filter((f) => f.type !== "longText");
  const long = kind.fields.filter((f) => f.type === "longText");

  return (
    <div className="res-view pl-detail">
      <ResourceHeader
        meta={p}
        subtitle={stage ? <span>{formatField(stage, data[stage.id])}</span> : done ? <span className="pl-done-badge">Done</span> : undefined}
        actions={
          kind.doneField ? (
            <Button variant={done ? "plain" : "tinted"} icon="check" onClick={() => set(kind.doneField!, !done)}>
              {done ? "Mark not done" : "Mark done"}
            </Button>
          ) : undefined
        }
      />

      {short.length > 0 && (
        <section className="res-card pl-fields">
          {short.map((f) => (
            <Field key={f.id} label={f.label}>
              <FieldInput field={f} value={data[f.id]} onChange={(v) => set(f.id, v)} />
            </Field>
          ))}
        </section>
      )}

      {long.map((f) => (
        <section key={f.id} className="pl-section">
          <h2 className="pl-section-title">{f.label}</h2>
          <FieldInput field={f} value={data[f.id]} onChange={(v) => set(f.id, v)} />
        </section>
      ))}

      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>
          {`Delete ${kind.label.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
