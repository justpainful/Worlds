import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FakeSyncServer } from "./fakeServer";
import { MemoryLocalStore } from "./localStore";
import { fragmentOf } from "./mirror";
import { CollabSession } from "./session";

const p = (bid: string, text: string): JSONContent => ({ type: "paragraph", attrs: { bid }, content: [{ type: "text", text }] });
const texts = (blocks: JSONContent[] | undefined) => (blocks ?? []).map((b) => b.content?.[0]?.text ?? "");

const open: CollabSession[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

async function until(pred: () => boolean, what: string, timeout = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function pc(server: FakeSyncServer, user: string, store = new MemoryLocalStore()) {
  const s = new CollabSession({
    pageId: "page1",
    workspaceId: "team",
    store,
    user: () => ({ id: user, name: user, color: "#64a8ff" }),
    firstSyncWaitMs: 300,
    mirrorDelayMs: 5,
    provider: {
      serverUrl: "https://sync.test",
      getToken: async () => `t-${user}`,
      createSocket: server.socketFor(user),
      minBackoffMs: 5,
      maxBackoffMs: 30,
      isOnline: () => true,
      watchOnline: () => () => undefined,
    },
  });
  open.push(s);
  return { s, store };
}

describe("CollabSession (two computers, one shared page)", () => {
  it("shares a page, mirrors edits into both computers' rows, and folds Claude's edits in", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("ben", "edit");

    // Ann's computer has the page as rows; sharing seeds the document.
    const a = pc(server, "ann");
    a.store.blocks.set("page1", [p("b1", "Plan"), p("b2", "Budget")]);
    await a.s.start();
    await until(() => a.s.info.state === "synced", "ann synced");
    expect(texts(a.s.blocks())).toEqual(["Plan", "Budget"]);
    expect(server.docs[0].getXmlFragment("default").length).toBe(2);

    // Ben's computer has nothing yet: the server's document fills his rows.
    const b = pc(server, "ben");
    await b.s.start();
    await until(() => texts(b.store.blocks.get("page1")).join("|") === "Plan|Budget", "ben's rows");

    // Ann types; both computers' rows follow (search, MCP and Claude see it).
    const t1 = (fragmentOf(a.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    t1.insert(4, " for Q3");
    await until(() => texts(b.store.blocks.get("page1"))[0] === "Plan for Q3", "ben's rows after ann typed");
    await until(() => texts(a.store.blocks.get("page1"))[0] === "Plan for Q3", "ann's rows");

    // Claude edits Ben's rows through MCP while Ann keeps typing in block 1.
    b.store.externalWrite("page1", [p("b1", "Plan for Q3"), p("b2", "Budget: 12k"), p("b3", "Risks")]);
    t1.insert(0, ">> ");
    await b.s.reconcile();
    await until(
      () => texts(a.store.blocks.get("page1")).join("|") === ">> Plan for Q3|Budget: 12k|Risks" && texts(b.store.blocks.get("page1")).join("|") === ">> Plan for Q3|Budget: 12k|Risks",
      "both rows include ann's typing and Claude's edit",
    );
    await until(() => a.s.info.state === "synced" && b.s.info.state === "synced", "both synced");
    expect(await a.store.outbox(null)).toEqual([]);
    expect(await b.store.outbox(null)).toEqual([]);
  });

  it("keeps working offline and catches up on reconnect", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("ben", "edit");
    const a = pc(server, "ann");
    a.store.blocks.set("page1", [p("b1", "one")]);
    await a.s.start();
    const b = pc(server, "ben");
    await b.s.start();
    await until(() => a.s.info.state === "synced" && b.s.info.state === "synced", "synced");

    server.up = false;
    server.dropAll();
    await until(() => b.s.info.state !== "synced", "ben offline");
    const tb = (fragmentOf(b.s.content).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    tb.insert(3, " (ben offline)");
    // Offline edits still reach Ben's own rows right away.
    await until(() => texts(b.store.blocks.get("page1"))[0] === "one (ben offline)", "ben's rows while offline");
    expect((await b.store.outbox("page1")).length).toBeGreaterThan(0);

    server.up = true;
    await until(() => texts(a.store.blocks.get("page1"))[0] === "one (ben offline)", "ann receives after reconnect", 6000);
    await until(() => b.s.info.state === "synced", "ben synced");
    expect(await b.store.outbox(null)).toEqual([]);
  });
});
