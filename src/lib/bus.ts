/** Typed app-wide events for actions that cross surfaces (palette → editor, header → composer). */
export interface BusEvents {
  "ai:open": { pageId: string | null; prompt?: string };
  "editor:command": { pageId: string; command: string; args?: unknown };
  "discord:compose": { pageId: string };
  "automation:new": { pageId: string | null };
  "page:info": { pageId: string; panel: "info" | "history" | "instructions" };
}

const target = new EventTarget();

export function emit<K extends keyof BusEvents>(type: K, detail: BusEvents[K]) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on<K extends keyof BusEvents>(type: K, fn: (detail: BusEvents[K]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<BusEvents[K]>).detail);
  target.addEventListener(type, h);
  return () => target.removeEventListener(type, h);
}
