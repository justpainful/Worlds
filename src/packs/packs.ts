/** Pack hooks and actions (the registry itself is in ./registry.ts). */
import { useStore } from "../state/store";
import { enabledPacks, PACKS_KEY, type PackId } from "./registry";

export * from "./registry";

export function usePack(id: PackId): boolean {
  return useStore((s) => enabledPacks(s.settings).has(id));
}

export function setPackEnabled(id: PackId, on: boolean) {
  const s = useStore.getState();
  const next = enabledPacks(s.settings);
  if (on) next.add(id);
  else next.delete(id);
  s.setSetting(PACKS_KEY, [...next]);
  // Lists that filter with plain helpers re-read when the page map changes.
  useStore.setState({ pages: { ...useStore.getState().pages } });
}
