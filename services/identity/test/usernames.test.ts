import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { usernameProblem } from "../src/lib/usernames";
import { api, lastCode, signUp, uniqueEmail } from "./helpers";

async function create(body: Record<string, unknown>) {
  const email = uniqueEmail("u");
  const start = await api("POST", "/auth/email/start", { body: { email } });
  return api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(email), device: { name: "PC" }, ...body } });
}

describe("usernames", () => {
  it("allows three characters, not two, and only the safe set", () => {
    expect(usernameProblem("abc")).toBeNull();
    expect(usernameProblem("a_b")).toBeNull();
    expect(usernameProblem("ab")).toBe("too_short");
    expect(usernameProblem("a".repeat(21))).toBe("too_long");
    expect(usernameProblem("Abc")).toBe("invalid_characters");
    expect(usernameProblem(".abc")).toBe("invalid_characters");
    expect(usernameProblem("ab..c")).toBe("invalid_characters");
    expect(usernameProblem("admin")).toBe("reserved");
  });

  it("gives every new account a username, its own when free", async () => {
    const mine = await create({ displayName: "Sara", username: "@Sra" });
    expect(mine.status).toBe(200);
    expect(mine.json.user.username).toBe("sra");
    expect(mine.json.user.usernameAuto).toBe(false);

    // Taken: the account is still made, with a system username marked automatic.
    const other = await create({ displayName: "Sara", username: "sra" });
    expect(other.json.user.username).not.toBe("sra");
    expect(other.json.user.username.length).toBeGreaterThanOrEqual(3);
    expect(other.json.user.usernameAuto).toBe(true);

    const none = await create({ displayName: "Nora Ali" });
    expect(none.json.user.username).toMatch(/^noraali\d*$/);
    expect(none.json.user.usernameAuto).toBe(true);
  });

  it("assigns one to an account that has none", async () => {
    const s = await signUp("Old");
    await env.DB.prepare("UPDATE users SET username = NULL WHERE id = ?1").bind(s.userId).run();
    const me = await api("GET", "/me", { token: s.accessToken });
    expect(me.json.username).toMatch(/^old\d*$/);
    expect(me.json.usernameAuto).toBe(true);
  });

  it("changes a username only to a valid, free one, and never clears it", async () => {
    const a = await signUp("Alpha");
    const b = await signUp("Beta");
    const set = await api("PATCH", "/me", { token: a.accessToken, body: { username: "xyz" } });
    expect(set.status).toBe(200);
    expect(set.json.username).toBe("xyz");
    expect(set.json.usernameAuto).toBe(false);

    const taken = await api("PATCH", "/me", { token: b.accessToken, body: { username: "XYZ" } });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe("username_taken");

    const short = await api("PATCH", "/me", { token: b.accessToken, body: { username: "xy" } });
    expect(short.status).toBe(400);
    expect(short.json.error).toBe("invalid_username");

    const cleared = await api("PATCH", "/me", { token: b.accessToken, body: { username: null } });
    expect(cleared.status).toBe(400);

    // Keeping your own name is not a conflict.
    expect((await api("PATCH", "/me", { token: a.accessToken, body: { username: "xyz" } })).status).toBe(200);
  });

  it("answers whether a name is free", async () => {
    const a = await signUp("Gamma");
    await api("PATCH", "/me", { token: a.accessToken, body: { username: "gma" } });
    const taken = await api("GET", "/auth/username/gma");
    expect(taken.json).toMatchObject({ valid: true, available: false, reason: "taken" });
    const free = await api("GET", "/auth/username/q7z");
    expect(free.json).toMatchObject({ valid: true, available: true });
    const bad = await api("GET", "/auth/username/q");
    expect(bad.json).toMatchObject({ valid: false, reason: "too_short" });
  });
});
