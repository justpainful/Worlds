import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawingGestureLeases } from "./gestureLeases";
import { DrawingWireError } from "./wire";
import { newDrawing } from "./operations";
const controllers: DrawingGestureLeases[] = []; afterEach(() => { for (const c of controllers.splice(0)) c.stop(); });
describe("gesture lease handoff", () => {
  it("releases when a native acknowledgement arrives before final pointer handoff", async () => {
    const request = vi.fn(async (body: { action: string; target: string }) => body.action === "release" ? null : { target: body.target, token: "private", fence: 1 });
    const c = new DrawingGestureLeases({ request }); controllers.push(c);
    const lease = await c.begin(["drawing:root"], newDrawing().scene); c.acknowledge(["already-saved"]); lease.finish(["already-saved"]);
    expect(c.proofs()).toHaveLength(0); expect(request.mock.calls.at(-1)![0].action).toBe("release");
  });
  it("shares one fenced reservation across overlapping gestures and keeps it until every exact operation is acknowledged", async () => {
    const request = vi.fn(async (body: { action: string; target: string }) => body.action === "release" ? null : { target: body.target, token: "private", fence: 1 });
    const c = new DrawingGestureLeases({ request }); controllers.push(c); const scene = newDrawing().scene;
    const [first, second] = await Promise.all([c.begin(["node:a"], scene), c.begin(["node:a"], scene)]);
    expect(request).toHaveBeenCalledTimes(1); first.finish(["first-edit"]); second.finish(["second-edit"]); c.acknowledge(["first-edit"]);
    expect(c.proofs()).toHaveLength(1); expect(request).toHaveBeenCalledTimes(1); c.acknowledge(["second-edit"]); await Promise.resolve(); expect(c.proofs()).toHaveLength(0); expect(request.mock.calls.at(-1)![0].action).toBe("release");
  });
  it("waits for a prior release before reacquiring so a late old release cannot invalidate a new gesture", async () => {
    let release!: () => void, fence = 0; const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async (body: { action: string; target: string }) => { if (body.action === "release") { await gate; return null; } return { target: body.target, token: "private", fence: ++fence }; });
    const c = new DrawingGestureLeases({ request }); controllers.push(c); const scene = newDrawing().scene, first = await c.begin(["node:a"], scene); first.cancel();
    let completed = false; const next = c.begin(["node:a"], scene).then((lease) => { completed = true; return lease; }); await Promise.resolve(); await Promise.resolve(); expect(completed).toBe(false);
    release(); expect((await next).state()).toBe("locked"); expect(c.proofs()[0].fence).toBe(2);
  });
  it("distinguishes offline work from denied or lost fences, renews current ownership and bounds acknowledgement holds", async () => {
    let now = 0, mode = "ok";
    const c = new DrawingGestureLeases({ now: () => now, request: async (body) => { if (mode === "offline") throw new Error("offline"); if (mode === "denied") throw new DrawingWireError("denied", "denied"); if (mode === "replaced") throw new DrawingWireError("lease", "stale fence"); return body.action === "release" ? null : { target: body.target, token: "private", fence: 1 }; } }); controllers.push(c); const scene = newDrawing().scene;
    mode = "denied"; await expect(c.begin(["node:a"], scene)).rejects.toThrow("denied"); mode = "offline"; const offline = await c.begin(["node:a"], scene); expect(offline.state()).toBe("offline");
    mode = "ok"; const online = await c.begin(["node:a"], scene); now = 10000; await c.renew(); expect(online.state()).toBe("locked");
    mode = "replaced"; await c.renew(); expect(online.state()).toBe("lost"); expect(c.proofs()).toHaveLength(0); online.cancel();
    mode = "ok"; const queued = await c.begin(["node:b"], scene); queued.finish(["never-acknowledged"]); now += 31000; await c.renew(); expect(c.proofs()).toHaveLength(0); c.stop(); expect(offline.state()).toBe("lost");
  });
});
