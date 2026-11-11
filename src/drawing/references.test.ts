import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {} }));
import { DrawingReferenceCache, type ReferencePreview } from "./references";
import { newNode, newScene, validateScene } from "./model";
describe("source-rights-aware drawing references", () => {
  it("removes the prior title during revalidation and never retains it after denied access", async () => {
    let allowed = true;
    const cache = new DrawingReferenceCache(async () =>
      allowed
        ? { state: "ready", title: "Private project", checkedAt: 1 }
        : { state: "unavailable", title: "Must not display", checkedAt: 2 },
    );
    await cache.refresh("source");
    expect(cache.get("source").title).toBe("Private project");
    allowed = false;
    const pending = cache.refresh("source");
    expect(cache.get("source")).toMatchObject({ state: "loading" });
    expect(cache.get("source").title).toBeUndefined();
    await pending;
    expect(cache.get("source")).toMatchObject({ state: "unavailable" });
    expect(cache.get("source").title).toBeUndefined();
    cache.dispose();
  });
  it("deduplicates simultaneous reads and ignores late responses after disposal", async () => {
    let deliver!: (value: ReferencePreview) => void;
    const load = vi.fn(() => {
        return new Promise<ReferencePreview>((resolve) => {
          deliver = resolve;
        });
      }),
      cache = new DrawingReferenceCache(load),
      onChange = vi.fn();
    cache.onChange = onChange;
    const a = cache.refresh("source"),
      b = cache.refresh("source");
    expect(a).toBe(b);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    cache.dispose();
    onChange.mockClear();
    deliver({ state: "ready", title: "Late private title", checkedAt: Date.now() });
    await a;
    expect(onChange).not.toHaveBeenCalled();
    expect(cache.get("source").title).toBeUndefined();
  });
  it("prevents live preview content from entering the durable scene", () => {
    const scene = newScene(),
      node = newNode("reference", scene.layerOrder[0], scene.defaultFrameId);
    node.sourceId = "source";
    node.sourceMode = "live";
    scene.nodes[node.id] = node;
    scene.nodeOrder = [node.id];
    validateScene(scene);
    node.sourceTitle = "Private title";
    expect(() => validateScene(scene)).toThrow("source reference");
    delete node.sourceTitle;
    node.sourceMode = "snapshot";
    node.referenceSnapshot = { title: "Explicit copy", kind: "page", checkedAt: 1 };
    validateScene(scene);
  });
  it("retains only timestamps when a source goes offline, including an untrusted offline response", async () => {
    let online = true;
    const cache = new DrawingReferenceCache(async () =>
      online
        ? {
            state: "ready",
            title: "Secret title",
            excerpt: "Private text",
            imageAttachmentId: "private-original",
            updatedAt: 7,
            checkedAt: 1,
          }
        : { state: "offline", title: "Leaked title", imageAttachmentId: "leaked-file", checkedAt: 2 },
    );
    await cache.refresh("source");
    const checked = cache.get("source").checkedAt;
    online = false;
    await cache.refresh("source");
    expect(cache.get("source")).toMatchObject({ state: "offline", lastReadyAt: checked, lastUpdatedAt: 7 });
    expect(JSON.stringify(cache.get("source"))).not.toContain("Secret");
    expect(cache.get("source").title).toBeUndefined();
    expect(cache.get("source").imageAttachmentId).toBeUndefined();
    cache.dispose();
  });
  it("ensure awaits the initial read and reuses a current permission check", async () => {
    const load = vi.fn(async () => ({ state: "ready" as const, title: "Current", checkedAt: Date.now() })),
      cache = new DrawingReferenceCache(load);
    expect((await cache.ensure("source")).title).toBe("Current");
    await cache.ensure("source");
    expect(load).toHaveBeenCalledTimes(1);
    cache.dispose();
  });
  it("offline invalidation discards an already in-flight privileged response", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    let finish!: (v: ReferencePreview) => void,
      count = 0;
    const cache = new DrawingReferenceCache(async () =>
      ++count === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { state: "offline", checkedAt: Date.now() },
    );
    try {
      const pending = cache.refresh("source");
      await Promise.resolve();
      events.dispatchEvent(new Event("offline"));
      await Promise.resolve();
      await Promise.resolve();
      finish({ state: "ready", title: "Late private data", imageAttachmentId: "late-original", checkedAt: Date.now() });
      await pending;
      await Promise.resolve();
      expect(cache.get("source").state).toBe("offline");
      expect(cache.get("source").title).toBeUndefined();
      expect(cache.get("source").imageAttachmentId).toBeUndefined();
    } finally {
      cache.dispose();
      vi.unstubAllGlobals();
    }
  });
});
