import { drawingLeaseCovers } from "./canonical";
import type { DrawingScene } from "./model";
import { DrawingWireError, type DrawingLeaseProof } from "./wire";
export interface DrawingGestureLease {
  state: () => "locked" | "offline" | "lost";
  subscribe: (listener: () => void) => () => void;
  finish: (operations: string[]) => void;
  cancel: () => void;
}
interface Bundle {
  id: string;
  state: "locked" | "offline" | "lost";
  targets: Set<string>;
  operations: Set<string> | null;
  finishedAt: number;
  listeners: Set<() => void>;
}
interface Held {
  proof: DrawingLeaseProof;
  until: number;
  users: Set<string>;
  renewing: boolean;
}
interface IO {
  request: (body: {
    action: "acquire" | "renew" | "release";
    target: string;
    requestId?: string;
    token?: string;
    fence?: number;
  }) => Promise<DrawingLeaseProof | null>;
  now?: () => number;
}
export function offlineDrawingGesture(active = () => true): DrawingGestureLease {
  let cancelled = false;
  return {
    state: () => (cancelled || !active() ? "lost" : "offline"),
    subscribe: () => () => {},
    finish: () => {},
    cancel: () => {
      cancelled = true;
    },
  };
}
/** A device keeps gesture proofs private and hands them to the operation
 * transport until its exact edits have been acknowledged, or the hold times out. */
export class DrawingGestureLeases {
  readonly requestId = crypto.randomUUID();
  private held = new Map<string, Held>();
  private bundles = new Map<string, Bundle>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private acknowledged = new Set<string>();
  private acquisitions: Promise<void> = Promise.resolve();
  private releases = new Map<string, Promise<unknown>>();
  private now: () => number;
  constructor(private io: IO) {
    this.now = io.now ?? (() => performance.now());
  }
  proofs() {
    return [...this.held.values()].filter((held) => held.until > this.now()).map((held) => held.proof);
  }
  private set(bundle: Bundle, state: Bundle["state"]) {
    if (bundle.state === state) return;
    bundle.state = state;
    for (const fn of bundle.listeners) fn();
  }
  begin(targets: string[], scene: DrawingScene): Promise<DrawingGestureLease> {
    const running = this.acquisitions.then(() => this.beginNow(targets, scene));
    this.acquisitions = running.then(
      () => undefined,
      () => undefined,
    );
    return running;
  }
  private async beginNow(targets: string[], scene: DrawingScene): Promise<DrawingGestureLease> {
    if (this.stopped) throw new Error("Drawing connection is closed");
    if (!targets.length) throw new DrawingWireError("invalid", "Choose a drawing element to reserve");
    const bundle: Bundle = {
      id: crypto.randomUUID(),
      state: "locked",
      targets: new Set(),
      operations: null,
      finishedAt: 0,
      listeners: new Set(),
    };
    this.bundles.set(bundle.id, bundle);
    try {
      const desired = targets.length > 8 ? ["drawing:root"] : [...new Set(targets)].sort();
      for (const target of desired) {
        await Promise.all(this.releases.values());
        let held = [...this.held.values()].find((held) => held.until > this.now() && drawingLeaseCovers(scene, held.proof.target, target));
        if (!held) {
          const proof = await this.io.request({ action: "acquire", target, requestId: this.requestId });
          if (this.stopped) throw new Error("Drawing connection is closed");
          if (!proof) throw new DrawingWireError("lease", "The drawing element could not be reserved");
          held = { proof, until: this.now() + 12000, users: new Set(), renewing: false };
          this.held.set(proof.target, held);
        }
        held.users.add(bundle.id);
        bundle.targets.add(held.proof.target);
        if (this.stopped) throw new Error("Drawing connection is closed");
      }
    } catch (e) {
      this.drop(bundle);
      if (!this.stopped && (!(e instanceof DrawingWireError) || e.code === "unavailable"))
        return offlineDrawingGesture(() => !this.stopped);
      throw e;
    }
    this.timer ??= setInterval(() => void this.renew(), 4000);
    return {
      state: () => {
        if (this.stopped || !this.bundles.has(bundle.id)) return "lost";
        if (bundle.state === "locked" && [...bundle.targets].some((target) => (this.held.get(target)?.until ?? 0) <= this.now()))
          this.set(bundle, "offline");
        return bundle.state;
      },
      subscribe: (fn) => {
        bundle.listeners.add(fn);
        return () => {
          bundle.listeners.delete(fn);
        };
      },
      finish: (operations) => {
        const waiting = operations.filter((id) => !this.acknowledged.has(id));
        if (!waiting.length) this.drop(bundle);
        else {
          bundle.operations = new Set(waiting);
          bundle.finishedAt = this.now();
        }
      },
      cancel: () => this.drop(bundle),
    };
  }
  acknowledge(operations: Iterable<string>) {
    const accepted = (this.acknowledged = new Set(operations));
    for (const bundle of this.bundles.values())
      if (bundle.operations) {
        for (const id of accepted) bundle.operations.delete(id);
        if (!bundle.operations.size) this.drop(bundle);
      }
  }
  private drop(bundle: Bundle) {
    if (!this.bundles.delete(bundle.id)) return;
    for (const target of bundle.targets) {
      const held = this.held.get(target);
      if (!held) continue;
      held.users.delete(bundle.id);
      if (!held.users.size) {
        this.held.delete(target);
        if (!this.stopped) {
          const release = this.io
            .request({ action: "release", ...held.proof })
            .catch(() => {})
            .finally(() => {
              if (this.releases.get(target) === release) this.releases.delete(target);
            });
          this.releases.set(target, release);
        }
      }
    }
    if (!this.held.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  async renew() {
    for (const bundle of this.bundles.values()) if (bundle.operations && this.now() - bundle.finishedAt > 30000) this.drop(bundle);
    await Promise.all(
      [...this.held.values()].map(async (held) => {
        if (held.renewing || this.stopped) return;
        held.renewing = true;
        try {
          const proof = await this.io.request({ action: "renew", ...held.proof });
          if (!proof || this.stopped || this.held.get(proof.target) !== held) return;
          held.proof = proof;
          held.until = this.now() + 12000;
          for (const id of held.users) {
            const bundle = this.bundles.get(id);
            if (bundle) this.set(bundle, "locked");
          }
        } catch (error) {
          const unavailable = !(error instanceof DrawingWireError) || error.code === "unavailable";
          if (!unavailable) held.until = 0;
          for (const id of held.users) {
            const bundle = this.bundles.get(id);
            if (bundle) this.set(bundle, unavailable ? "offline" : "lost");
          }
        } finally {
          held.renewing = false;
        }
      }),
    );
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const bundle of this.bundles.values()) this.set(bundle, "lost");
    this.bundles.clear();
    this.held.clear();
    this.acknowledged.clear();
  }
}
