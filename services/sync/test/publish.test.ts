import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, grant, mintToken, uid } from "./client";

async function packRole(workspaceId: string, packId: string, roleId: string, userIds: string[]) {
  await env.IDENTITY_CONTROL.fetch("https://identity/pack-role", { method: "POST", body: JSON.stringify({ workspaceId, packId, roleId, userIds }) });
}

async function feed(user: string) {
  const token = await mintToken(user);
  return (await (await SELF.fetch(`${BASE}/v1/notifications`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
    items: { id: string; kind: string; from: string; excerpt: string; readAt: number | null; item?: { source: string; target: string; title: string; fields: Record<string, unknown> } }[];
    unread: number;
  };
}

async function publish(user: string, ws: string, doc: string, body: Record<string, unknown>) {
  const token = await mintToken(user);
  return SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${doc}/publish`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

const quiz = (fields: Record<string, unknown>) => ({ packId: "teacher", roleId: "student", source: "teacher.assessment", target: "study.assignment", title: "Quiz 1", fields, fromName: "Ms Huda" });

describe("publishing a pack item (docs/PACKS.md, Design 3)", () => {
  it("reaches every member with the role, and a second publish replaces the first", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("teacher", ws, doc, "edit");
    await packRole(ws, "teacher", "student", ["sara", "lama", "teacher"]);

    const first = await publish("teacher", ws, doc, quiz({ due: "2026-11-20", points: 10 }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, sent: 2 });

    const sara = await feed("sara");
    expect(sara.items[0]).toMatchObject({ kind: "published", from: "teacher", excerpt: "Quiz 1", item: { target: "study.assignment", fields: { due: "2026-11-20", points: 10 } } });
    expect(sara.unread).toBe(1);
    // The publisher does not send to themself.
    expect((await feed("teacher")).items.filter((n) => n.kind === "published")).toEqual([]);

    // Read, then the teacher moves the date: one copy, unread again, with the new date.
    await SELF.fetch(`${BASE}/v1/notifications/read`, { method: "POST", headers: { authorization: `Bearer ${await mintToken("sara")}` }, body: JSON.stringify({ ids: null }) });
    await publish("teacher", ws, doc, quiz({ due: "2026-11-22", points: 10 }));
    const again = await feed("sara");
    const copies = again.items.filter((n) => n.kind === "published");
    expect(copies).toHaveLength(1);
    expect(copies[0].item?.fields.due).toBe("2026-11-22");
    expect(again.unread).toBe(1);
  });

  it("needs edit access and well formed ids", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("viewer", ws, doc, "view");
    await grant("teacher", ws, doc, "edit");
    expect((await publish("viewer", ws, doc, quiz({}))).status).toBe(403);
    expect((await publish("teacher", ws, doc, { ...quiz({}), packId: "Teacher" })).status).toBe(400);
    expect((await publish("teacher", ws, doc, { ...quiz({}), target: "study" })).status).toBe(400);
    expect((await publish("teacher", ws, doc, { ...quiz({}), fields: "x" })).status).toBe(400);
    expect((await publish("stranger", ws, doc, quiz({}))).status).toBe(403);
  });
});
