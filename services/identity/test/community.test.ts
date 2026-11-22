import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, lastCode, outbox, signUp, uniqueEmail, type Session } from "./helpers";

async function owner(): Promise<Session> {
  const s = await signUp("Community Boss");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  return s;
}

async function guest() {
  const email = uniqueEmail("idea");
  const start = await api("POST", "/auth/email/start", { body: { email } });
  const s = await api("POST", "/support/session", { body: { challengeId: start.json.challengeId, code: lastCode(email) } });
  return { "x-support-session": s.json.token as string };
}

describe("suggestions", () => {
  it("goes from a new idea to the board, gets votes, and tells voters when it ships", async () => {
    const boss = await owner();
    const fan = await signUp("Fan");
    const idea = await api("POST", "/community/suggestions", { headers: await guest(), body: { title: "Dark mode for drawings", body: "Please." } });
    expect(idea.status).toBe(201);
    expect(idea.json.votes).toBe(1);
    // Not public until the team approves it.
    expect((await api("GET", "/community/suggestions")).json.some((s: { id: string }) => s.id === idea.json.id)).toBe(false);
    await api("PATCH", `/admin/suggestions/${idea.json.id}`, { token: boss.accessToken, body: { public: true, status: "planned" } });
    const board = await api("GET", "/community/suggestions", { token: fan.accessToken });
    expect(board.json.find((s: { id: string }) => s.id === idea.json.id)).toMatchObject({ status: "planned", voted: false });

    const vote = await api("POST", `/community/suggestions/${idea.json.id}/vote`, { token: fan.accessToken, body: {} });
    expect(vote.json).toEqual({ votes: 2, voted: true });
    expect((await api("POST", `/community/suggestions/${idea.json.id}/vote`)).status).toBe(400);
    expect((await api("GET", "/community/roadmap")).json.planned.map((s: { id: string }) => s.id)).toContain(idea.json.id);

    const shipped = await api("PATCH", `/admin/suggestions/${idea.json.id}`, { token: boss.accessToken, body: { status: "shipped", shippedIn: "1.1.0" } });
    expect(shipped.json.told).toBe(1);
    const note = (await outbox("user.notify")).filter((e) => e.userId === fan.userId).at(-1);
    expect(note.notification).toMatchObject({ topic: "suggestion.shipped", excerpt: "Worlds 1.1.0" });
  });

  it("merges a duplicate and moves its votes", async () => {
    const boss = await owner();
    const a = await api("POST", "/community/suggestions", { headers: await guest(), body: { title: "Tabs" } });
    const b = await api("POST", "/community/suggestions", { headers: await guest(), body: { title: "Tabs please" } });
    await api("POST", `/admin/suggestions/${b.json.id}/merge`, { token: boss.accessToken, body: { into: a.json.id } });
    const list = await api("GET", "/admin/suggestions", { token: boss.accessToken });
    expect(list.json.find((s: { id: string }) => s.id === a.json.id).votes).toBe(2);
    expect(list.json.find((s: { id: string }) => s.id === b.json.id)).toMatchObject({ status: "duplicate", mergedInto: a.json.id });
  });
});

describe("testers, surveys and messages", () => {
  it("lets someone apply as a tester and be accepted", async () => {
    const boss = await owner();
    const t = await signUp("Tester");
    expect((await api("POST", "/me/testers", { token: t.accessToken, body: { platforms: ["windows", "android"] } })).json.status).toBe("applied");
    await api("POST", `/admin/testers/${t.userId}`, { token: boss.accessToken, body: { status: "accepted" } });
    expect((await api("GET", "/me/testers", { token: t.accessToken })).json.status).toBe("accepted");
  });

  it("asks one question, takes one answer per person, and counts them", async () => {
    const boss = await owner();
    const s = await api("POST", "/admin/surveys", {
      token: boss.accessToken,
      body: { questionAr: "وش تبي بعد؟", questionEn: "What next?", choices: [{ ar: "الرسم", en: "Drawing" }, { ar: "الجداول", en: "Tables" }] },
    });
    const person = await signUp("Answerer");
    const open = await api("GET", "/me/surveys", { token: person.accessToken });
    expect(open.json.map((x: { id: string }) => x.id)).toContain(s.json.id);
    expect((await api("POST", `/me/surveys/${s.json.id}`, { token: person.accessToken, body: { choice: 1 } })).status).toBe(200);
    expect((await api("POST", `/me/surveys/${s.json.id}`, { token: person.accessToken, body: { choice: 0 } })).status).toBe(409);
    expect((await api("GET", "/me/surveys", { token: person.accessToken })).json.map((x: { id: string }) => x.id)).not.toContain(s.json.id);
    const results = await api("GET", "/admin/surveys", { token: boss.accessToken });
    expect(results.json.find((x: { id: string }) => x.id === s.json.id)).toMatchObject({ answers: 1, counts: [0, 1] });
  });

  it("carries a conversation between the team and one person", async () => {
    const boss = await owner();
    const p = await signUp("Pen Pal");
    const thread = await api("POST", `/admin/users/${p.userId}/messages`, { token: boss.accessToken, body: { subject: "Your report", body: "Can you send a picture?" } });
    expect(thread.status).toBe(201);
    const mine = await api("GET", "/me/messages", { token: p.accessToken });
    expect(mine.json[0]).toMatchObject({ subject: "Your report", messages: [{ author: "team", body: "Can you send a picture?" }] });
    expect((await api("POST", `/me/messages/${thread.json.id}`, { token: p.accessToken, body: { body: "Sure, here." } })).status).toBe(201);
    const seen = await api("GET", `/admin/messages/${thread.json.id}`, { token: boss.accessToken });
    expect(seen.json.messages.map((m: { author: string }) => m.author)).toEqual(["team", "person"]);
    expect(seen.json.messages[0].read).toBe(true);
  });
});
