/** One pack item: its fields to edit, built from the kind's definition, and the items that link to it. */
import { useMemo } from "react";
import { trashItem } from "../../planning/actions";
import { Field } from "../../planning/ui";
import { ResourceHeader } from "../../resources/views/ResourceHeader";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { menuAt } from "../../ui/Menu";
import { EmptyState } from "../../ui/misc";
import { promptMenu } from "../actions";
import type { PageMeta } from "../../lib/types";
import type { FieldDef, KindDef, PackDef } from "../definition";
import { fieldsFor, useViewAs } from "../roles";
import { useItemSync } from "../useItemSync";
import { sendItem } from "../published";
import { formatField, inSentence } from "../fields";
import { createPackItem, itemData, updatePackItem } from "../items";
import { kindDefOf } from "../registry";
import { packItems } from "../rules";
import { FieldInput } from "./FieldInput";
import { PackTable } from "./PackTable";

export function PackItemView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  const def = p ? kindDefOf(p.kind) : undefined;
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This item is not here any more" text="It may have been deleted." />;
  if (!def) return <EmptyState icon="warning" title="This item belongs to a pack Worlds does not have" text="It is kept as it is; a newer Worlds may open it." />;
  const { kind, pack } = def;
  return <ItemFields p={p} pack={pack} kind={kind} />;
}

function ItemFields({ p, pack, kind }: { p: PageMeta; pack: PackDef; kind: KindDef }) {
  // In a team, the fields stay in step with everyone who has this item open.
  useItemSync(p.id);
  // A role preview from the pack's view applies here too.
  const [viewAs] = useViewAs(pack.id, pack.roles);
  const fields = fieldsFor(kind, viewAs);
  const data = itemData(p);
  const set = (fieldId: string, v: unknown) => void updatePackItem(p, { [fieldId]: v });
  const done = kind.doneField ? data[kind.doneField] === true : false;
  const stage = kind.stageField ? kind.fields.find((f) => f.id === kind.stageField) : undefined;
  const short = fields.filter((f) => f.type !== "longText");
  const long = fields.filter((f) => f.type === "longText");

  return (
    <div className="res-view pl-detail">
      <ResourceHeader
        meta={p}
        subtitle={stage ? <span>{formatField(stage, data[stage.id])}</span> : done ? <span className="pl-done-badge">Done</span> : undefined}
        actions={
          <>
            {pack.prompts?.length ? (
              <Button variant="plain" icon="assistant" onClick={(e) => menuAt(e.currentTarget, promptMenu(pack, p.id), "end")}>
                Ask Claude
              </Button>
            ) : null}
            {kind.publish ? (
              <Button variant="plain" icon="send" onClick={() => void send(p)}>
                {kind.publish.label}
              </Button>
            ) : null}
            {kind.doneField ? (
              <Button variant={done ? "plain" : "tinted"} icon="check" onClick={() => set(kind.doneField!, !done)}>
                {done ? "Mark not done" : "Mark done"}
              </Button>
            ) : null}
          </>
        }
      />

      {short.length > 0 && (
        <section className="res-card pl-fields">
          {short.map((f) => (
            <Field key={f.id} label={f.label}>
              <FieldInput field={f} value={data[f.id]} pack={pack} onChange={(v) => set(f.id, v)} />
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

      <LinkedHere pack={pack} kind={kind} id={p.id} />

      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>
          {`Delete ${inSentence(kind.label)}`}
        </Button>
      </div>
    </div>
  );
}

/** Send an item to the members holding its kind's role (a teacher's assessment to the students). */
async function send(p: PageMeta) {
  const r = await sendItem(p);
  const toast = useStore.getState().toast;
  if ("error" in r) toast({ message: r.error, tone: "error" });
  else toast({ message: r.sent === 1 ? "Sent to 1 member" : r.sent ? `Sent to ${r.sent} members` : "No one has this role in the pack yet.", tone: r.sent ? "success" : "info" });
}

/** Every kind that links to this one gets a list here: a client's quotes and invoices. */
function LinkedHere({ pack, kind, id }: { pack: PackDef; kind: KindDef; id: string }) {
  const pages = useStore((s) => s.pages);
  const groups = useMemo(() => {
    const out: { kind: KindDef; field: FieldDef; items: ReturnType<typeof packItems> }[] = [];
    for (const k of pack.kinds) {
      for (const f of k.fields) {
        if (f.type !== "link" || f.to !== kind.id) continue;
        out.push({ kind: k, field: f, items: packItems(pages, pack, k.id).filter((x) => itemData(x)[f.id] === id) });
      }
    }
    return out;
  }, [pages, pack, kind.id, id]);

  return (
    <>
      {groups.map(({ kind: k, field, items }) => (
        <section key={`${k.id}.${field.id}`} className="pl-section">
          <div className="pk-section-head">
            <h2 className="pl-section-title">{k.plural}</h2>
            <Button variant="plain" icon="add" onClick={() => void createPackItem(pack, k, { data: { [field.id]: id }, open: "current" })}>
              {`Add ${inSentence(k.label)}`}
            </Button>
          </div>
          {items.length ? (
            <PackTable kind={k} items={items} columns={k.fields.filter((f) => !f.detailOnly && f.id !== field.id).map((f) => f.id)} />
          ) : (
            <p className="pk-none">{`No ${inSentence(k.plural)} yet`}</p>
          )}
        </section>
      ))}
    </>
  );
}
