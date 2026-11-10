import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {}, errorMessage: (e: unknown) => e instanceof Error ? e.message : String(e) }));
import { DrawingSession, type DrawingSessionIO } from "./session";
import { appendOperation, edit, newDrawing } from "./operations";
import type { DrawingDocument } from "./model";
import { newNode } from "./model";
import { putNode } from "./operations";
import type { RecoveryRecord } from "./session";

describe("drawing durable queue", () => {
  it("blocks input in every pane through the native restore and reload, then permits normal edits", async () => {
    let native = newDrawing(), release!: () => void, reloaded!: () => void, restoring = false;
    const gate = new Promise<void>((resolve) => { release = resolve; }), reload = new Promise<void>((resolve) => { reloaded = resolve; });
    const session = new DrawingSession("drawing", { load: async () => { if (restoring) await reload; return structuredClone(native); }, read: async () => undefined, write: async () => {}, apply: async (_page, op) => native = appendOperation(native, op) });
    await session.flush(); const layer = native.scene.layerOrder[0];
    const running = session.restore(async (before) => { restoring = true; await gate; native = appendOperation(before, edit("alice", before.revision, "Restore", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Restored" } }])); });
    expect(session.snapshot().restoring).toBe(true);
    expect(session.dispatch(edit("alice", 0, "Other pane", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Lost" } }]))).toBe(false);
    await expect(session.restore(async () => {})).rejects.toThrow("already running");
    release(); await Promise.resolve(); await Promise.resolve(); expect(session.snapshot().restoring).toBe(true);
    reloaded(); await running; expect(session.snapshot()).toMatchObject({ restoring: false, pending: 0 }); expect(session.snapshot().document?.scene.layers[layer].name).toBe("Restored");
    expect(session.dispatch(edit("alice", 1, "Later edit", [{ type: "patch", collection: "layers", id: layer, fields: { opacity: 0.5 } }]))).toBe(true); await session.flush(); expect(native.revision).toBe(2);
    await expect(session.restore(async () => { throw new Error("refused"); })).rejects.toThrow("refused"); expect(session.snapshot().restoring).toBe(false);
  });
  it("recovers renderer-only work after restart and retries a lost native reply with the same archive ID", async () => {
    const initial = newDrawing(), layer = initial.scene.layerOrder[0];
    const pending = edit("alice",0,"Local name",[{type:"patch",collection:"layers",id:layer,fields:{name:"Local ink"}}]);
    let native = appendOperation(initial,edit("bob",0,"Remote name",[{type:"patch",collection:"layers",id:layer,fields:{name:"Shared ink"}}]));
    let stored: RecoveryRecord = {acknowledged:initial,pending:[pending]};
    const session = new DrawingSession("drawing",{load:async()=>structuredClone(native),read:async()=>structuredClone(stored),write:async(_page,record)=>{stored=structuredClone(record);},apply:vi.fn()});
    await session.flush(); expect(session.snapshot()).toMatchObject({recovered:true,pending:1});
    const ids: string[] = [];
    await expect(session.recover(async(input)=>{
      ids.push(input.recoveryId); expect(input.document.scene.layers[layer].name).toBe("Local ink"); expect(input.record.acknowledged).toEqual(initial); expect(input.record.pending).toEqual([pending]); expect(input.expectedRevision).toBe(1);
      expect(session.dispatch(edit("alice",1,"Too late",[{type:"patch",collection:"layers",id:layer,fields:{name:"Uncaptured ink"}}]))).toBe(false);
      native=structuredClone(native); throw new Error("Native reply interrupted after commit");
    })).rejects.toThrow("reply interrupted");
    expect(session.snapshot().document?.scene.layers[layer].name).toBe("Local ink"); expect(stored.pending).toHaveLength(1);
    await session.recover(async(input)=>{ids.push(input.recoveryId);return "copy";});
    expect(ids[0]).toBe(ids[1]); expect(stored.pending).toHaveLength(0);
    expect(session.snapshot()).toMatchObject({recovered:false,pending:0,error:null,saving:false}); expect(session.snapshot().document?.scene.layers[layer].name).toBe("Shared ink");
  });
  it("does not call native recovery when the durable renderer archive cannot be written", async () => {
    const native=newDrawing(), work=vi.fn(async()=>{});
    const session=new DrawingSession("drawing",{load:async()=>native,read:async()=>undefined,apply:vi.fn(),write:async()=>{throw new Error("disk full");}});
    await session.flush(); await expect(session.recover(work)).rejects.toThrow("disk full"); expect(work).not.toHaveBeenCalled(); expect(session.snapshot().recovered).toBe(true);
  });
  it("serializes simultaneous checkpoints even when the writer is idle", async () => {
    let native = newDrawing(), release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const session = new DrawingSession("drawing", { load: async () => structuredClone(native), read: async () => undefined, write: async () => {}, apply: async (_page, operation) => native = appendOperation(native, operation) });
    await session.flush();
    const events: string[] = [];
    const first = session.checkpoint(async () => { events.push("first-start"); await gate; events.push("first-end"); });
    const second = session.checkpoint(async () => { events.push("second-start"); });
    await vi.waitFor(() => expect(events).toContain("first-start"));
    expect(events).toEqual(["first-start"]);
    release(); await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });
  it("rebases pointer input arriving while a native checkpoint is in flight", async () => {
    let native = newDrawing(), release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const apply = vi.fn(async (_page: string, operation: Parameters<DrawingSessionIO["apply"]>[1]) => native = appendOperation(native, operation));
    const session = new DrawingSession("drawing", { load: async () => structuredClone(native), read: async () => undefined, write: async () => {}, apply });
    await session.flush();
    const a = newNode("shape", native.scene.layerOrder[0], native.scene.defaultFrameId), b = newNode("shape", native.scene.layerOrder[0], native.scene.defaultFrameId); a.shape = b.shape = "rect";
    const started = vi.fn();
    const checkpoint = session.checkpoint(async (basis) => { started(); await gate; native = appendOperation(basis, edit("bob", basis.revision, "Bob shape", putNode(basis.scene, b))); });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    expect(session.dispatch(edit("alice", 0, "Alice shape", putNode(native.scene, a)))).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    release(); await checkpoint; await session.flush();
    expect(native.scene.nodeOrder).toEqual([b.id, a.id]);
    expect(session.snapshot().document?.scene.nodeOrder).toEqual([b.id, a.id]);
    expect(session.snapshot()).toMatchObject({ recovered: false, pending: 0, error: null });
  });
  it("preserves conflicting pointer input and its recovery record during a checkpoint", async () => {
    let native = newDrawing(), release!: () => void, stored: RecoveryRecord | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const apply = vi.fn(async (_page: string, operation: Parameters<DrawingSessionIO["apply"]>[1]) => native = appendOperation(native, operation));
    const session = new DrawingSession("drawing", { load: async () => structuredClone(native), read: async () => undefined, write: async (_page, record) => { stored = structuredClone(record); }, apply });
    await session.flush(); const layer = native.scene.layerOrder[0], started = vi.fn();
    const checkpoint = session.checkpoint(async (basis) => { started(); await gate; native = appendOperation(basis, edit("bob", 0, "Remote name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Remote ink" } }])); });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    session.dispatch(edit("alice", 0, "Local name", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Local ink" } }]));
    release(); await checkpoint; await session.flush();
    expect(native.scene.layers[layer].name).toBe("Remote ink");
    expect(session.snapshot()).toMatchObject({ recovered: true, pending: 1 });
    expect(session.snapshot().document?.scene.layers[layer].name).toBe("Local ink");
    expect(stored?.pending).toHaveLength(1); expect(stored?.preconditions?.[stored.pending[0].id]).toBeDefined();
    expect(apply).not.toHaveBeenCalled();
  });
  it("a second flush waits for the running write and every queued operation", async () => {
    let native = newDrawing(), release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const apply = vi.fn(async (_page: string, operation: Parameters<DrawingSessionIO["apply"]>[1]) => { if (operation.base === 0) await gate; native = appendOperation(native, operation); return structuredClone(native); });
    const session = new DrawingSession("drawing", { load: async () => native, apply, read: async () => undefined, write: async () => {} });
    await session.flush();
    const lid = native.scene.layerOrder[0];
    session.dispatch(edit("owner", 0, "Name", [{ type: "patch", collection: "layers", id: lid, fields: { name: "Ink" } }]));
    session.dispatch(edit("owner", 1, "Opacity", [{ type: "patch", collection: "layers", id: lid, fields: { opacity: 0.5 } }]));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    let done = false; const flush = session.flush().then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); expect(done).toBe(false);
    release(); await flush;
    expect(apply).toHaveBeenCalledTimes(2); expect(session.snapshot().pending).toBe(0); expect(session.snapshot().error).toBeNull();
    expect(native.scene.layers[lid]).toMatchObject({ name: "Ink", opacity: 0.5 });
  });
  it("retains unsaved edits after a recovery-store failure and retries them", async () => {
    let native: DrawingDocument = newDrawing(), writable = false;
    const session = new DrawingSession("drawing", { load: async () => native, read: async () => undefined,
      apply: async (_page, operation) => native = appendOperation(native, operation),
      write: async () => { if (!writable) throw new Error("disk full"); },
    });
    await session.flush();
    session.dispatch(edit("owner", 0, "Name", [{ type: "patch", collection: "layers", id: native.scene.layerOrder[0], fields: { name: "Recovered ink" } }]));
    await session.flush(); expect(session.snapshot()).toMatchObject({ pending: 1, saving: false, error: "Storage is full or its quota was exceeded. Some changes may be unsaved; free space and retry before closing the app." });
    expect(native.revision).toBe(0);
    writable = true; await session.flush(); expect(session.snapshot().pending).toBe(0); expect(native.revision).toBe(1);
  });
});
