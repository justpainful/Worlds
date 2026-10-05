/**
 * End to end against a running sync service (real Worker, Durable Objects,
 * WebSockets) and the local identity stand-in. Skipped unless both are up:
 *
 *   cd services/sync && pnpm dev:identity   (port 8791)
 *   cd services/sync && pnpm dev            (port 8790)
 *   WORLDS_SYNC_E2E=1 pnpm test src/sync/e2e.test.ts
 *
 * Each "computer" is a CollabSession with its own local store, exactly as
 * the desktop app runs it, minus the editor.
 */
import type { JSONContent } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { MemoryLocalStore } from "./localStore";
import { fragmentOf } from "./mirror";
import { CollabSession } from "./session";
import { createThread, listThreads, upsertPerson } from "./comments";
import { listVersions, restoreInto, saveVersion, versionState } from "./versions";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SYNC = env.WORLDS_SYNC_URL ?? "http://127.0.0.1:8790";
const IDENTITY = env.WORLDS_IDENTITY_URL ?? "http://127.0.0.1:8791";
const enabled = !!env.WORLDS_SYNC_E2E;

const p = (bid: string, text: string): JSONContent => ({ type: "paragraph", attrs: { bid }, content: [{ type: "text", text }] });
const texts = (blocks: JSONContent[] | undefined) => (blocks ?? []).map((b) => b.content?.[0]?.text ?? "");
const run = Date.now().toString(36);
const WS = `e2e${run}`;

async function token(sub: string): Promise<string> {
  const r = await fetch(`${IDENTITY}/dev/token?sub=${sub}&dev=${sub}-pc`);
  return ((await r.json()) as { token: string }).token;
}

async function grant(userId: string, docId: string, level: string) {
  await fetch(`${IDENTITY}/dev/grant`, { method: "POST", body: JSON.stringify({ userId, workspaceId: WS, docId, level }) });
}

async function until(pred: () => boolean | Promise<boolean>, what: string, timeout = 8000) {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const open: CollabSession[] = [];
afterAll(async () => {
  for (const s of open) await s.close();
});

type Files = Map<string, { fileName: string; mime: string; bytes: Uint8Array }>;

function computer(user: string, pageId: string, net = { online: true, watchers: new Set<(o: boolean) => void>() }, files: Files = new Map()) {
  const store = new MemoryLocalStore();
  let tok: string | null = null;
  const s = new CollabSession({
    pageId,
    workspaceId: WS,
    store,
    user: () => ({ id: user, name: user[0].toUpperCase() + user.slice(1), color: "#64a8ff" }),
    firstSyncWaitMs: 3000,
    mirrorDelayMs: 20,
    attachments: {
      readLocal: async (id) => files.get(id) ?? null,
      storeLocal: async (id, info, bytes) => void files.set(id, { fileName: info.fileName, mime: info.mime, bytes }),
    },
    provider: {
      serverUrl: SYNC,
      getToken: async (refresh) => (tok && !refresh ? tok : (tok = await token(user))),
      minBackoffMs: 50,
      maxBackoffMs: 500,
      isOnline: () => net.online,
      watchOnline: (fn) => {
        net.watchers.add(fn);
        return () => net.watchers.delete(fn);
      },
    },
  });
  open.push(s);
  return { s, store, net, files };
}

describe.skipIf(!enabled)("live sync end to end", { timeout: 60_000 }, () => {
  it("two computers share a page, type, fold Claude's edits, and stay converged", async () => {
    const page = `page${run}a`;
    const ann = computer("ann", page);
    ann.store.blocks.set(page, [p("b1", "Agenda"), p("b2", "Notes")]);
    await ann.s.start();
    await until(() => ann.s.info.state === "synced", "ann synced");
    expect(ann.s.info.level).toBe("edit");

    const ben = computer("ben", page);
    await ben.s.start();
    await until(() => texts(ben.store.blocks.get(page)).join("|") === "Agenda|Notes", "ben's rows from the server");

    // Live typing on both sides at once.
    const a1 = (fragmentOf(ann.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    const b2 = (fragmentOf(ben.s.content).get(1) as Y.XmlElement).get(0) as Y.XmlText;
    a1.insert(6, " for Monday");
    b2.insert(5, " from Ben");
    await until(
      () => texts(ann.store.blocks.get(page)).join("|") === "Agenda for Monday|Notes from Ben" && texts(ben.store.blocks.get(page)).join("|") === "Agenda for Monday|Notes from Ben",
      "both rows converge",
    );

    // Claude edits Ann's rows through MCP; Ben sees it.
    ann.store.externalWrite(page, [...(ann.store.blocks.get(page) ?? []), p("b3", "Action items")]);
    await ann.s.reconcile();
    await until(() => texts(ben.store.blocks.get(page)).includes("Action items"), "Claude's block reaches Ben");

    // Shared history: a labelled version with its authors, then a restore
    // that reaches the other computer as an ordinary edit.
    const tok = await token("ann");
    const vapi = { serverUrl: SYNC, getToken: async () => tok, workspaceId: WS, docId: page };
    const v = await saveVersion(vapi, "Before cleanup");
    expect(v.authors.sort()).toEqual(["ann", "ben"]);
    const t0 = (fragmentOf(ann.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    t0.delete(0, t0.length);
    await until(() => texts(ben.store.blocks.get(page))[0] === "", "deletion reaches ben");
    restoreInto(ann.s.content, await versionState(vapi, v.id));
    await until(() => texts(ben.store.blocks.get(page))[0] === "Agenda for Monday", "restore reaches ben");
    expect((await listVersions(vapi)).some((x) => x.id === v.id && x.label === "Before cleanup")).toBe(true);

    // Presence.
    await until(() => [...ben.s.provider.awareness.getStates().values()].some((st) => (st as { user?: { id?: string } }).user?.id === "ann"), "ann's presence at ben");
  });

  it("an offline computer's queued edits arrive when it reconnects", async () => {
    const page = `page${run}b`;
    const ann = computer("ann", page);
    ann.store.blocks.set(page, [p("b1", "Draft")]);
    await ann.s.start();
    const ben = computer("ben", page);
    await ben.s.start();
    await until(() => ann.s.info.state === "synced" && ben.s.info.state === "synced", "both synced");

    ben.net.online = false;
    for (const w of ben.net.watchers) w(false);
    await until(() => ben.s.info.state === "offline", "ben offline");
    const t = (fragmentOf(ben.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    for (let i = 0; i < 10; i++) t.insert(t.length, ` ${i}`);
    await ben.s.provider.persisted();
    expect((await ben.store.outbox(page)).length).toBeGreaterThan(0);
    const a = (fragmentOf(ann.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    a.insert(0, "Final ");

    ben.net.online = true;
    for (const w of ben.net.watchers) w(true);
    await until(() => texts(ann.store.blocks.get(page))[0] === "Final Draft 0 1 2 3 4 5 6 7 8 9", "ann has ben's offline edits");
    await until(() => texts(ben.store.blocks.get(page))[0] === "Final Draft 0 1 2 3 4 5 6 7 8 9", "ben has ann's edit");
    await until(async () => (await ben.store.outbox(null)).length === 0, "ben's outbox drained");
  });

  it("attachments travel between computers: resumable upload, verified download, same id", async () => {
    const page = `page${run}d`;
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 31 + 7) & 255); // two parts
    const small = new TextEncoder().encode("minutes.txt contents");
    const annFiles: Files = new Map([
      ["att-big", { fileName: "demo.mp4", mime: "video/mp4", bytes: big }],
      ["att-small", { fileName: "minutes.txt", mime: "text/plain", bytes: small }],
    ]);
    const ann = computer("ann", page, undefined, annFiles);
    ann.store.blocks.set(page, [
      p("b1", "Files"),
      { type: "video", attrs: { bid: "v1", attachmentId: "att-big" } },
      { type: "file", attrs: { bid: "f1", attachmentId: "att-small", name: "minutes.txt" } },
    ]);
    await ann.s.start();
    await until(() => ann.s.attachmentDirectory().size === 2, "ann uploaded both", 30_000);
    const ben = computer("ben", page);
    await ben.s.start();
    await until(() => ben.files.size === 2, "ben downloaded both", 30_000);
    expect(ben.files.get("att-small")!.bytes).toEqual(small);
    expect(ben.files.get("att-big")!.bytes.byteLength).toBe(big.byteLength);
    expect(ben.files.get("att-big")!.bytes).toEqual(big);
    expect(ben.files.get("att-big")!.fileName).toBe("demo.mp4");
  });

  it("comments with mentions notify, viewers stay read-only, revocation disconnects", async () => {
    const page = `page${run}c`;
    await grant("vic", page, "view");
    const ann = computer("ann", page);
    ann.store.blocks.set(page, [p("b1", "Spec")]);
    await ann.s.start();
    const ben = computer("ben", page);
    await ben.s.start();
    await until(() => ann.s.info.state === "synced" && ben.s.info.state === "synced", "synced");
    upsertPerson(ben.s.comments, ben.s.user);
    upsertPerson(ann.s.comments, ann.s.user);

    createThread(ann.s.comments, ann.s.user, { anchor: null, quote: "Spec", body: "@Ben can you review?", mentions: ["ben"] });
    await until(() => listThreads(ben.s.comments).length === 1, "thread reaches ben");
    const benToken = await token("ben");
    await until(async () => {
      const r = await fetch(`${SYNC}/v1/notifications`, { headers: { authorization: `Bearer ${benToken}` } });
      const body = (await r.json()) as { items: { kind: string; from: string; fromName?: string; docId: string }[] };
      return body.items.some((n) => n.kind === "mention" && n.from === "ann" && n.fromName === "Ann" && n.docId === page);
    }, "mention notification for ben");

    const vic = computer("vic", page);
    await vic.s.start();
    await until(() => vic.s.info.level === "view" && vic.s.info.state === "synced", "viewer synced");
    expect(vic.s.canEdit).toBe(false);
    expect(texts(vic.store.blocks.get(page))).toEqual(["Spec"]);
    // A write slipped past the editor is refused and kept aside.
    ((fragmentOf(vic.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, "HACK ");
    await until(() => !!vic.s.info.attention, "refusal noticed");
    await until(() => texts(ann.store.blocks.get(page))[0] === "Spec", "server unchanged");

    await grant("ben", page, "none");
    const r = await fetch(`${SYNC}/internal/revoke`, {
      method: "POST",
      headers: { authorization: "Bearer dev-internal-secret" },
      body: JSON.stringify({ userId: "ben", workspaceId: WS }),
    });
    expect(((await r.json()) as { affected: number }).affected).toBeGreaterThan(0);
    await until(() => ben.s.info.level === "none" && ben.s.info.state === "error", "ben revoked");
    expect(ann.s.info.state).not.toBe("error");
  });
});
