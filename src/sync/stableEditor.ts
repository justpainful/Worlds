/**
 * A shared page's editor can be created again while the page stays open
 * (its documents were rebuilt after a refused write). Views around the
 * editor keep the first editor they were handed, so shared pages hand out
 * this stable stand-in instead: it always forwards to the live editor and
 * moves event listeners over when the editor is replaced.
 */
import type { Editor } from "@tiptap/core";

type Handler = (...args: unknown[]) => void;

export class StableEditor {
  private current: Editor;
  private listeners: [string, Handler][] = [];
  readonly proxy: Editor;

  constructor(initial: Editor) {
    this.current = initial;
    const self = this;
    this.proxy = new Proxy(initial, {
      get(_target, prop) {
        const live = self.current;
        if (prop === "on") {
          return (event: string, fn: Handler) => {
            self.listeners.push([event, fn]);
            live.on(event as never, fn as never);
            return self.proxy;
          };
        }
        if (prop === "off") {
          return (event: string, fn?: Handler) => {
            self.listeners = self.listeners.filter(([e, f]) => !(e === event && (!fn || f === fn)));
            live.off(event as never, fn as never);
            return self.proxy;
          };
        }
        const v = Reflect.get(live, prop, live) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(live) : v;
      },
      set(_target, prop, value) {
        return Reflect.set(self.current, prop, value, self.current);
      },
      has(_target, prop) {
        return Reflect.has(self.current, prop);
      },
    });
  }

  /** Point at a new editor; listeners registered through the stand-in follow. */
  swap(next: Editor) {
    if (next === this.current) return;
    for (const [event, fn] of this.listeners) {
      this.current.off(event as never, fn as never);
      next.on(event as never, fn as never);
    }
    this.current = next;
  }
}
