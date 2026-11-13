/**
 * What the shell asks of enabled packs: their sidebar entries, commands,
 * New menu items and Home sections, all read from their definitions. Kept
 * apart from ./packs.ts because it reaches the packs' own components.
 */
import { useMemo } from "react";
import type { OpenWhere, Route } from "../state/store";
import { useStore } from "../state/store";
import type { IconName } from "../ui/Icon";
import { PACK_CREATORS } from "./components";
import type { KindDef, PackDef, ViewDef } from "./definition";
import { createPackItem } from "./items";
import { enabledPacks, PACK_DEFS, PACKS_KEY } from "./registry";

export function enabledPackDefs(settings: Record<string, unknown>): PackDef[] {
  const on = enabledPacks(settings);
  return PACK_DEFS.filter((p) => on.has(p.id));
}

/** The packs turned on now, stable between renders while the setting is unchanged. */
export function useEnabledPacks(): PackDef[] {
  const list = useStore((s) => s.settings[PACKS_KEY]);
  return useMemo(() => enabledPackDefs({ [PACKS_KEY]: list }), [list]);
}

export function packRoute(pack: PackDef, view?: ViewDef): Route {
  return { kind: "pack", pack: pack.id, view: view?.id ?? pack.sidebar[0] };
}

/** A pack's sidebar entries; the first is named after the pack. */
export function sidebarEntries(pack: PackDef): { view: ViewDef; label: string; route: Route }[] {
  return pack.sidebar
    .map((id) => pack.views.find((v) => v.id === id))
    .filter((v): v is ViewDef => !!v)
    .map((view, i) => ({ view, label: i === 0 ? pack.label : view.label, route: packRoute(pack, view) }));
}

/** How a kind is created: its own creator when the pack has one, else from its starting values. */
export function packCreator(pack: PackDef, kind: KindDef): () => unknown {
  return PACK_CREATORS[`${pack.id}.${kind.id}`] ?? (() => createPackItem(pack, kind, { open: "current" }));
}

/** New menu items of the enabled packs. */
export function packNewItems(settings: Record<string, unknown>): { label: string; icon: IconName; onSelect: () => void }[] {
  return enabledPackDefs(settings).flatMap((pack) =>
    (pack.newMenu ?? [])
      .map((id) => pack.kinds.find((k) => k.id === id))
      .filter((k): k is KindDef => !!k)
      .map((kind) => ({ label: kind.label, icon: "folder" as IconName, onSelect: () => void packCreator(pack, kind)() })),
  );
}

/** Command palette entries of the enabled packs: open each sidebar view, and create each New menu kind. */
export function packCommands(settings: Record<string, unknown>, open: (r: Route, where: OpenWhere) => void) {
  return enabledPackDefs(settings).flatMap((pack) => [
    ...sidebarEntries(pack).map(({ view, label, route }) => ({
      id: `pack-${pack.id}-${view.id}`,
      title: label,
      icon: view.icon,
      keywords: pack.keywords ?? "",
      run: (w: OpenWhere) => open(route, w),
    })),
    ...(pack.newMenu ?? [])
      .map((id) => pack.kinds.find((k) => k.id === id))
      .filter((k): k is KindDef => !!k)
      .map((kind) => ({
        id: `pack-${pack.id}-new-${kind.id}`,
        title: `New ${kind.label}`,
        icon: view0Icon(pack),
        keywords: `${pack.keywords ?? ""} ${kind.plural}`.trim(),
        run: () => void packCreator(pack, kind)(),
      })),
  ]);
}

function view0Icon(pack: PackDef): IconName {
  return pack.views.find((v) => v.id === pack.sidebar[0])?.icon ?? "folder";
}
