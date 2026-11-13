/** A pack's view, opened from the sidebar: its own component, or a table or board built from its definition. */
import { useMemo } from "react";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/misc";
import { PACK_COMPONENTS } from "../components";
import { storedKind } from "../definition";
import { createPackItem, itemsOf } from "../items";
import { setPackEnabled, usePack } from "../packs";
import { packDef } from "../registry";
import { PackBoard } from "./PackBoard";
import { PackTable } from "./PackTable";

export function PackView({ pack: packId, view: viewId }: { pack: string; view?: string }) {
  const pack = packDef(packId);
  const on = usePack(packId);
  const pages = useStore((s) => s.pages);
  const view = pack ? (pack.views.find((v) => v.id === (viewId ?? pack.sidebar[0])) ?? pack.views[0]) : undefined;
  const kind = pack && view?.kind ? pack.kinds.find((k) => k.id === view.kind) : undefined;
  const items = useMemo(() => (pack && kind ? itemsOf(pages, storedKind(pack, kind)) : []), [pages, pack, kind]);

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
        <Button variant="tinted" icon="add" onClick={() => void createPackItem(pack, kind, { open: "current" })}>
          {`Add ${kind.label.toLowerCase()}`}
        </Button>
      </header>
      {items.length === 0 ? (
        <EmptyState icon="info" title="Nothing here yet" text={kind.blurb} />
      ) : view.type === "board" ? (
        <PackBoard pack={pack} kind={kind} items={items} groupBy={view.groupBy ?? kind.stageField ?? ""} />
      ) : (
        <PackTable kind={kind} items={items} columns={view.columns} />
      )}
    </div>
  );
}
