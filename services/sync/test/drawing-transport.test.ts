import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { BASE, grant, mintToken, uid } from "./client";
import { DrawingTransport, type DrawingTransportIO, type DrawingTransportInfo } from "../../../src/drawing/transport";
import { canonicalOperation, drawingPreconditions } from "../../../src/drawing/canonical";
import { appendOperation, edit, newDrawing, putNode } from "../../../src/drawing/operations";
import { newNode, type DrawingDocument, type DrawingOperation } from "../../../src/drawing/model";
import type { DrawingReplica } from "../../../src/drawing/replica";
import type { LocalFile } from "../../../src/sync/attachments";
import { pixelGuard } from "../../../src/drawing/pixelGuard";

// The adapter is intentionally in memory: this suite exercises the actual
// desktop transport against the Worker. Rust has separate SQLite/reopen tests.
async function client(ws: string, page: string, user: string, initial: DrawingDocument, saved?: DrawingReplica) {
  const replica: DrawingReplica = saved ?? { pageId: page, workspaceId: ws, userId: user, serverUrl: BASE, localActor: user, document: structuredClone(initial), basis: structuredClone(initial), remote: null, pending: [], versions: {}, attachmentIds: [], level: "edit", status: "pending", error: null };
  let online = true, info: DrawingTransportInfo | undefined, loseNextWrite = false,legacyCapabilities:false|true|number=false,pixelWrites=0,seedWrites=0;
  const originals = new Map<string, LocalFile>();
  const io: DrawingTransportIO = {
    snapshot: async () => structuredClone(replica),
    status: async (status, error) => { replica.status = status; replica.error = error || null; },
    readOriginal: async (id) => originals.get(id) ?? null,
    storeOriginal: async (id, original, bytes) => { originals.set(id, { fileName: original.fileName, mime: original.mime, bytes }); },
    checkpoint: async (state) => {
      const pending = replica.pending.filter((p) => !state.document!.operations.some((op) => op.id === p.operation.id));
      let document = structuredClone(state.document!);
      try { for (const p of pending) document = appendOperation(document, canonicalOperation(document, p.operation, user, p.preconditions)); }
      catch { replica.status = "conflict"; return { status: "conflict" }; }
      replica.remote = structuredClone(state); replica.document = document; replica.pending = pending;
      return { status: "accepted", document };
    },
  };
  const transport = new DrawingTransport({ pageId: page, workspaceId: ws, userId: user, serverUrl: BASE, io, getToken: () => mintToken(user), onInfo: (value) => { info = value; }, fetcher: async (input, init) => {
    if (!online) throw new Error("Test connection interrupted");
    if(String(input).endsWith("/drawing/operations")&&typeof init?.body==="string"&&JSON.parse(init.body).operation?.pixelGuard)pixelWrites++;
    if(String(input).endsWith("/drawing/state")&&init?.method==="PUT")seedWrites++;
    const response = await SELF.fetch(input, init);
    if (loseNextWrite && String(input).endsWith("/drawing/operations")) { loseNextWrite = false; throw new Error("Test response lost after server commit"); }
    if(legacyCapabilities&&String(input).includes("/drawing/state")){const value=await response.json<Record<string,unknown>>();if(legacyCapabilities===true)delete value.capabilities;else value.capabilities={pixelSourceGuards:legacyCapabilities};return new Response(JSON.stringify(value),{status:response.status,headers:response.headers});}return response;
  } });
  const queue = (operation: DrawingOperation) => { replica.pending.push({ operation, preconditions: drawingPreconditions(replica.document.scene, operation) }); replica.document = appendOperation(replica.document, operation); replica.status = "pending"; };
  return { replica, transport, originals, queue, info: () => info, offline: () => { online = false; }, loseWrite: () => { loseNextWrite = true; },legacy:(value:boolean|number=true)=>{legacyCapabilities=value;},writes:()=>({pixelWrites,seedWrites}) };
}

describe("drawing desktop transport with real sync authority", () => {
  it("keeps guarded edits and initial guarded history local until the service advertises enforcement",async()=>{
    const ws=uid("ws"),page=uid("drawing"),user=uid("alice"),initial=newDrawing();await grant(user,ws,page,"edit");const alice=await client(ws,page,user,initial);
    try{await alice.transport.tick();alice.legacy();const op=edit(user,0,"Pixel erase",[]);op.pixelGuard=pixelGuard(initial.scene,initial.scene.defaultFrameId,initial.scene.layerOrder[0],"current");alice.queue(op);await alice.transport.tick();expect(alice.info()?.status).toBe("offline");expect(alice.replica.pending).toHaveLength(1);expect(alice.writes().pixelWrites).toBe(0);alice.legacy(false);await alice.transport.tick();expect(alice.replica.pending).toHaveLength(0);expect(alice.writes().pixelWrites).toBe(1);}finally{alice.transport.stop();}
    const second=uid("drawing");await grant(user,ws,second,"edit");const op=edit(user,0,"Historical erase",[]);op.pixelGuard=pixelGuard(initial.scene,initial.scene.defaultFrameId,initial.scene.layerOrder[0],"current");const seeded=await client(ws,second,user,appendOperation(initial,op));
    try{seeded.legacy();await seeded.transport.tick();expect(seeded.writes().seedWrites).toBe(0);expect(seeded.info()?.status).toBe("offline");seeded.legacy(false);await seeded.transport.tick();expect(seeded.writes().seedWrites).toBe(1);expect(seeded.info()?.status).toBe("synced");}finally{seeded.transport.stop();}
  });
  it("retains ancestor-aware receipts on a version1 service and synchronizes them only with version2",async()=>{
    const ws=uid("ws"),page=uid("drawing"),user=uid("alice"),initial=newDrawing(),child=initial.scene.layerOrder[0],parent={...structuredClone(initial.scene.layers[child]),id:"parent-group"};
    for(const s of [initial.seed,initial.scene]){s.layers[parent.id]=structuredClone(parent);s.layers[child].parentId=parent.id;s.layerOrder.unshift(parent.id);}
    await grant(user,ws,page,"edit");const alice=await client(ws,page,user,initial);
    try{await alice.transport.tick();alice.legacy(1);const op=edit(user,0,"Nested guarded edit",[]);op.pixelGuard=pixelGuard(initial.scene,initial.scene.defaultFrameId,child,"current");expect(op.pixelGuard.expected.ancestors).toHaveLength(1);alice.queue(op);await alice.transport.tick();expect(alice.writes().pixelWrites).toBe(0);expect(alice.replica.pending).toHaveLength(1);alice.legacy(false);await alice.transport.tick();expect(alice.replica.pending).toHaveLength(0);expect(alice.writes().pixelWrites).toBe(1);expect(alice.info()?.status).toBe("synced");}finally{alice.transport.stop();}
  });
  it("keeps strict source edits local until strict-base enforcement is advertised",async()=>{
    const ws=uid("ws"),page=uid("drawing"),user=uid("alice"),initial=newDrawing();await grant(user,ws,page,"edit");const alice=await client(ws,page,user,initial);
    try{await alice.transport.tick();alice.legacy(1);const operation=edit(user,0,"Strict source",[]);operation.requiresBase=true;alice.queue(operation);await alice.transport.tick();expect(alice.info()?.status).toBe("offline");expect(alice.replica.pending).toHaveLength(1);const remote=await SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${page}/drawing/state`,{headers:{authorization:`Bearer ${await mintToken(user)}`}});expect((await remote.json<{state:{revision:number}}>()).state.revision).toBe(0);alice.legacy(false);await alice.transport.tick();expect(alice.replica.pending).toHaveLength(0);expect(alice.replica.remote?.revision).toBe(1);}finally{alice.transport.stop();}
  });
  it("reserves an element before movement, keeps its fence through acknowledgement and exposes no private proof", async () => {
    const ws = uid("ws"), page = uid("drawing"), a = uid("alice"), b = uid("bob"), initial = newDrawing();
    await grant(a, ws, page, "edit"); await grant(b, ws, page, "edit");
    const alice = await client(ws, page, a, initial), bob = await client(ws, page, b, initial);
    try {
      await alice.transport.tick();
      const node = newNode("shape", initial.scene.layerOrder[0], initial.scene.defaultFrameId); node.shape = "rect";
      alice.queue(edit(a, 0, "Create", putNode(initial.scene, node))); await alice.transport.tick(); await bob.transport.tick();
      const target = `node:${node.id}`, lease = await alice.transport.beginGesture([target]); expect(lease.state()).toBe("locked");
      await bob.transport.tick();
      expect(bob.info()?.leases).toEqual([expect.objectContaining({ target, userId: a, mine: false })]);
      expect(bob.info()?.leases?.[0]).not.toHaveProperty("token"); expect(bob.info()?.leases?.[0]).not.toHaveProperty("requestId");
      await expect(bob.transport.beginGesture([target])).rejects.toMatchObject({ code: "lease" });
      expect(bob.replica.pending).toHaveLength(0); expect(bob.info()?.status).toBe("synced");
      const op = edit(a, 1, "Move", [{ type: "patch", collection: "nodes", id: node.id, fields: { x: 180 } }]);
      alice.queue(op); lease.finish([op.id]); expect(alice.transport.gestures.proofs()).toHaveLength(1);
      await alice.transport.tick(); expect(alice.replica.pending).toHaveLength(0); expect(alice.transport.gestures.proofs()).toHaveLength(0);
      const token = await mintToken(b), deadline = Date.now() + 5000;
      let remaining = 1;
      while (remaining && Date.now() < deadline) {
        const r = await SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${page}/drawing/leases`, { headers: { authorization: `Bearer ${token}` } });
        remaining = (await r.json<{ leases: unknown[] }>()).leases.length;
        if (remaining) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(remaining).toBe(0); await bob.transport.tick(); expect(bob.replica.document.scene.nodes[node.id].x).toBe(180);
      const next = await bob.transport.beginGesture([target]); expect(next.state()).toBe("locked"); next.cancel();
    } finally { alice.transport.stop(); bob.transport.stop(); }
  });
  it("reads a fresh authorized checkpoint for explicit recovery and refuses recovery after revocation", async () => {
    const ws=uid("ws"),page=uid("drawing"),a=uid("alice"),b=uid("bob"),initial=newDrawing(),layer=initial.scene.layerOrder[0];
    await grant(a,ws,page,"edit"); await grant(b,ws,page,"edit");
    const alice=await client(ws,page,a,initial),bob=await client(ws,page,b,initial);
    await alice.transport.tick(); await bob.transport.tick();
    bob.queue(edit(b,0,"Bob name",[{type:"patch",collection:"layers",id:layer,fields:{name:"My ink"}}]));
    alice.queue(edit(a,0,"Alice name",[{type:"patch",collection:"layers",id:layer,fields:{name:"Shared ink"}}])); await alice.transport.tick(); await bob.transport.tick();
    expect(bob.info()?.status).toBe("conflict"); expect(bob.replica.document.scene.layers[layer].name).toBe("My ink");
    await grant(b,ws,page,"none"); const denied=vi.fn(async()=>{});
    await expect(bob.transport.recover(denied)).rejects.toThrow(); expect(denied).not.toHaveBeenCalled(); expect(bob.info()?.level).toBe("none"); expect(bob.replica.pending).toHaveLength(1);
    await grant(b,ws,page,"view");
    const own=structuredClone(bob.replica.document);
    await bob.transport.recover(async(state)=>{expect(state.document!.scene.layers[layer].name).toBe("Shared ink"); bob.replica.remote=state;bob.replica.document=state.document!;bob.replica.pending=[];});
    expect(own.scene.layers[layer].name).toBe("My ink"); expect(bob.info()).toMatchObject({status:"synced",level:"view",revision:1});
    alice.transport.stop();bob.transport.stop();
  });
  it("converges offline additions after client restart and a lost server acknowledgement", async () => {
    const ws = uid("ws"), page = uid("drawing"), a = uid("alice"), b = uid("bob"), initial = newDrawing();
    await grant(a, ws, page, "edit"); await grant(b, ws, page, "edit");
    const alice = await client(ws, page, a, initial), bob = await client(ws, page, b, initial);
    const na = newNode("shape", initial.scene.layerOrder[0], initial.scene.defaultFrameId), nb = newNode("shape", initial.scene.layerOrder[0], initial.scene.defaultFrameId); na.shape = nb.shape = "rect";
    await alice.transport.tick(); await bob.transport.tick();
    bob.offline(); bob.queue(edit(b, 0, "Offline Bob", putNode(initial.scene, nb))); await bob.transport.tick();
    expect(bob.info()?.status).toBe("offline"); expect(bob.replica.pending).toHaveLength(1);
    alice.queue(edit(a, 0, "Alice", putNode(initial.scene, na))); alice.loseWrite(); await alice.transport.tick();
    expect(alice.info()?.status).toBe("offline"); expect(alice.replica.pending).toHaveLength(1);
    bob.transport.stop(); const restarted = await client(ws, page, b, initial, structuredClone(bob.replica));
    await restarted.transport.tick(); await alice.transport.tick();
    expect(alice.info()?.status).toBe("synced"); expect(restarted.info()?.status).toBe("synced");
    expect(alice.replica.pending).toHaveLength(0); expect(restarted.replica.pending).toHaveLength(0);
    expect(alice.replica.document.scene).toEqual(restarted.replica.document.scene);
    expect(new Set(alice.replica.document.scene.nodeOrder)).toEqual(new Set([na.id, nb.id]));
    expect(alice.replica.document.revision).toBe(2);
    alice.transport.stop(); restarted.transport.stop();
  });
  it("obtains protected-edit leases and stops uploads immediately after access downgrade", async () => {
    const ws = uid("ws"), page = uid("drawing"), user = uid("alice"), initial = newDrawing(); await grant(user, ws, page, "edit");
    const alice = await client(ws, page, user, initial); await alice.transport.tick();
    const layer = initial.scene.layerOrder[0];
    alice.queue(edit(user, 0, "Rename", [{ type: "patch", collection: "layers", id: layer, fields: { name: "Ink" } }])); await alice.transport.tick();
    expect(alice.info()?.status).toBe("synced"); expect(alice.replica.document.scene.layers[layer].name).toBe("Ink");
    await grant(user, ws, page, "view");
    alice.queue(edit(user, 1, "Opacity", [{ type: "patch", collection: "layers", id: layer, fields: { opacity: 0.3 } }])); await alice.transport.tick();
    expect(alice.info()).toMatchObject({ status: "denied", level: "view", pending: 1 }); expect(alice.replica.remote?.revision).toBe(1);
    await grant(user, ws, page, "none"); await alice.transport.tick(); expect(alice.info()).toMatchObject({ status: "denied", level: "none", pending: 1 });
    alice.transport.stop();
  });
  it("uploads and verifies original bytes before another computer accepts the scene", async () => {
    const ws = uid("ws"), page = uid("drawing"), a = uid("alice"), b = uid("bob"), initial = newDrawing(); await grant(a, ws, page, "edit"); await grant(b, ws, page, "view");
    const alice = await client(ws, page, a, initial), bob = await client(ws, page, b, initial); bob.replica.level = "view";
    await alice.transport.tick();
    const original = crypto.randomUUID(), asset = crypto.randomUUID(), bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    alice.originals.set(original, { fileName: "original.png", mime: "image/png", bytes }); alice.replica.attachmentIds.push(original);
    const node = newNode("image", initial.scene.layerOrder[0], initial.scene.defaultFrameId); node.assetId = asset;
    alice.queue(edit(a, 0, "Original", [{ type: "put", collection: "assets", id: asset, value: { id: asset, attachmentId: original, name: "Original", mime: "image/png", width: 1, height: 1 } }, ...putNode(initial.scene, node)]));
    await alice.transport.tick(); expect(alice.info()?.status).toBe("synced");
    await bob.transport.tick(); expect(bob.info()?.status).toBe("synced");
    expect(bob.originals.get(original)?.bytes).toEqual(bytes); expect(bob.replica.document.scene.nodes[node.id].assetId).toBe(asset);
    alice.transport.stop(); bob.transport.stop();
  });
});
