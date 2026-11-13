/** A pack's view, opened from the sidebar: its own component, or a table or board built from its definition. */
import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { menuAt } from "../../ui/Menu";
import { EmptyState } from "../../ui/misc";
import { promptMenu } from "../actions";
import { PACK_COMPONENTS } from "../components";
import type { PackDef } from "../definition";
import { inSentence } from "../fields";
import { createPackItem } from "../items";
import { setPackEnabled, usePack } from "../packs";
import { packDef } from "../registry";
import { alertItems, filterItems, packItems, todayIso } from "../rules";
import { addSamples } from "../samples";
import { PackBoard } from "./PackBoard";
import { PackTable } from "./PackTable";

export function PackView({ pack: packId, view: viewId }: { pack: string; view?: string }) {
  const pack = packDef(packId);
  const on = usePack(packId);
  const pages = useStore((s) => s.pages);
  const view = pack ? (pack.views.find((v) => v.id === (viewId ?? pack.sidebar[0])) ?? pack.views[0]) : undefined;
  const kind = pack && view?.kind ? pack.kinds.find((k) => k.id === view.kind) : undefined;
  const all = useMemo(() => (pack && kind ? packItems(pages, pack, kind.id) : []), [pages, pack, kind]);
  const items = useMemo(() => filterItems(all, view?.filter, todayIso()), [all, view]);

  if (!pack || !view) return <EmptyState icon="warning" title="This pack is not available" text="It may come from a newer version of Worlds." />;
  if (!on) {
    return (
      <EmptyState
        icon="info"
        title={`${pack.label} is turned off`}
        text="Turn it on to see it again. Nothing made with it was removed."
        action={
          <Button variant="tinted" onClick={() => setPackEnabled(pack.id, true)}>
            Turn on
          </Button>
        }
      />
    );
  }
  if (view.type === "custom") {
    const Custom = view.component ? PACK_COMPONENTS[view.component] : undefined;
    return Custom ? <Custom /> : <EmptyState icon="warning" title="This view is not available" text="It may come from a newer version of Worlds." />;
  }
  if (!kind) return null;

  return (
    <div className="pl-view pk-view">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">{view.label}</h1>
          <p className="pl-sub">{kind.blurb}</p>
        </div>
        <div className="pl-head-controls">
          {pack.prompts?.length ? (
            <Button variant="plain" icon="assistant" onClick={(e) => menuAt(e.currentTarget, promptMenu(pack), "end")}>
              Ask Claude
            </Button>
          ) : null}
          <Button variant="tinted" icon="add" onClick={() => void createPackItem(pack, kind, { open: "current" })}>
            {`Add ${inSentence(kind.label)}`}
          </Button>
        </div>
      </header>
      <Alerts pack={pack} kindId={kind.id} />
      {all.length === 0 ? (
        <EmptyState icon="info" title="Nothing here yet" text={kind.blurb} action={pack.samples?.length ? <SampleButton pack={pack} /> : undefined} />
      ) : items.length === 0 ? (
        <EmptyState icon="info" title="Nothing matches this view" text="Items appear here when they reach it." />
      ) : view.type === "board" ? (
        <PackBoard pack={pack} kind={kind} items={items} groupBy={view.groupBy ?? kind.stageField ?? ""} />
      ) : (
        <PackTable kind={kind} items={items} columns={view.columns} totals={view.totals} averages={view.averages} />
      )}
    </div>
  );
}

/** What needs attention among this view's kind. */
function Alerts({ pack, kindId }: { pack: PackDef; kindId: string }) {
  const pages = useStore((s) => s.pages);
  const list = useMemo(
    () =>
      (pack.alerts ?? [])
        .filter((a) => a.kind === kindId)
        .map((a) => ({ label: a.label, n: alertItems(pages, pack, a, todayIso()).length }))
        .filter((a) => a.n),
    [pages, pack, kindId],
  );
  if (!list.length) return null;
  return (
    <div className="pk-alerts">
      {list.map((a) => (
        <span key={a.label} className="pk-alert-chip" role="status">
          {a.label} <span className="pl-count">{a.n}</span>
        </span>
      ))}
    </div>
  );
}

/** Adds the pack's example items, so a person sees it working before typing anything. */
function SampleButton({ pack }: { pack: PackDef }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="tinted"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const n = await addSamples(pack, (sample, data, title) => {
          const kind = pack.kinds.find((k) => k.id === sample.kind);
          return kind ? createPackItem(pack, kind, { title, data, open: false }) : Promise.resolve(null);
        });
        setBusy(false);
        if (n) useStore.getState().toast({ message: "Examples added", tone: "success" });
      }}
    >
      Add examples
    </Button>
  );
}
