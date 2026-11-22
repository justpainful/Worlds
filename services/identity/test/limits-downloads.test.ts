import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, type Release } from "../src/routes/downloads";
import { api, lastCode, signUp } from "./helpers";

const DL = "https://github.com/justpainful/Worlds/releases/download";
const asset = (tag: string, name: string) => ({ name, size: 10, download_count: 3, browser_download_url: `${DL}/${tag}/${name}` });
const GITHUB = [
  {
    tag_name: "v1.2.0-beta.1",
    published_at: "2026-12-01T00:00:00Z",
    draft: false,
    prerelease: true,
    assets: [asset("v1.2.0-beta.1", "Worlds-1.2.0-Windows-x64-setup.exe")],
  },
  {
    tag_name: "v1.1.0",
    published_at: "2026-11-23T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [asset("v1.1.0", "Worlds-1.1.0-Windows-x64-setup.exe"), asset("v1.1.0", "Worlds-1.1.0-Android-Universal.apk")],
  },
  {
    tag_name: "v1.0.1",
    published_at: "2026-11-22T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [asset("v1.0.1", "Worlds-1.0.1-Windows-x64-setup.exe"), asset("v1.0.1", "Worlds-1.0.1-Android-Universal.apk"), asset("v1.0.1", "Worlds-1.0.1-macOS-Unsigned.dmg")],
  },
];

beforeEach(() => {
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => (String(input instanceof Request ? input.url : input).startsWith("https://api.github.com/") ? Response.json(GITHUB) : real(input, init)));
});
afterEach(() => vi.restoreAllMocks());

async function owner() {
  const boss = await signUp("Downloads Owner");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");
  const start = await api("POST", "/auth/email/start", { body: { email: boss.email } });
  await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(boss.email) } });
  return boss;
}

describe("download links", () => {
  it("picks the newest published file per platform, skipping pulled files and following a pinned release", () => {
    const list: Release[] = GITHUB.map((r) => ({
      tag: r.tag_name,
      publishedAt: r.published_at,
      draft: r.draft,
      prerelease: r.prerelease,
      assets: r.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })),
    }));
    const now = resolve(list, null, []);
    expect(now.tag).toBe("v1.1.0");
    expect(now.picks.find((p) => p.platform === "windows")?.name).toBe("Worlds-1.1.0-Windows-x64-setup.exe");
    // A platform the newest release lacks gets the last file it had.
    expect(now.picks.find((p) => p.platform === "macos")).toMatchObject({ tag: "v1.0.1", fallback: true });

    const pulled = resolve(list, null, ["Worlds-1.1.0-Windows-x64-setup.exe"]);
    expect(pulled.picks.find((p) => p.platform === "windows")).toMatchObject({ tag: "v1.0.1", fallback: true });
    expect(pulled.picks.find((p) => p.platform === "android")?.tag).toBe("v1.1.0");

    const pinned = resolve(list, "v1.0.1", []);
    expect(pinned.tag).toBe("v1.0.1");
    expect(pinned.picks.every((p) => p.tag === "v1.0.1")).toBe(true);
  });

  it("redirects to GitHub, and the team can pull a file or pin a release", async () => {
    const res = await api("GET", "/downloads");
    expect(res.json.tag).toBe("v1.1.0");
    const boss = await owner();

    const pull = await api("POST", "/admin/downloads/pull", { token: boss.accessToken, body: { name: "Worlds-1.1.0-Windows-x64-setup.exe", reason: "Crashes on start" } });
    expect(pull.status).toBe(200);
    const after = await api("GET", "/admin/downloads", { token: boss.accessToken });
    expect(after.json.pulled[0]).toMatchObject({ name: "Worlds-1.1.0-Windows-x64-setup.exe", reason: "Crashes on start" });
    expect(after.json.picks.find((p: { platform: string }) => p.platform === "windows").tag).toBe("v1.0.1");
    expect((await api("POST", "/admin/downloads/pull", { token: boss.accessToken, body: { name: "nothing.exe", reason: "x" } })).json.error).toBe("unknown_file");

    expect((await api("POST", "/admin/downloads/pin", { token: boss.accessToken, body: { tag: "v1.2.0-beta.1" } })).json.error).toBe("unknown_release");
    expect((await api("POST", "/admin/downloads/pin", { token: boss.accessToken, body: { tag: "v1.0.1" } })).status).toBe(200);
    expect((await api("GET", "/admin/downloads", { token: boss.accessToken })).json.current).toBe("v1.0.1");
    // The generic settings route cannot write the download links.
    expect((await api("PUT", "/admin/control/settings/downloads", { token: boss.accessToken, body: { value: { pinnedTag: null, pulled: [] } } })).status).toBe(400);
    await api("POST", "/admin/downloads/restore", { token: boss.accessToken, body: { name: "Worlds-1.1.0-Windows-x64-setup.exe" } });
    await api("POST", "/admin/downloads/pin", { token: boss.accessToken, body: { tag: null } });
    expect((await api("GET", "/admin/downloads", { token: boss.accessToken })).json.pulled).toEqual([]);
  });
});

describe("limits for one account", () => {
  it("defaults, a raise by the team, and the service binding sees it", async () => {
    const boss = await owner();
    const person = await signUp("Big Files");
    const before = await api("GET", `/admin/users/${person.userId}/limits`, { token: boss.accessToken });
    expect(before.json).toMatchObject({ webCopyMb: 32, fileMb: 25, custom: false });

    expect((await api("PUT", `/admin/users/${person.userId}/limits`, { token: boss.accessToken, body: { webCopyMb: 500 } })).json.error).toBe("invalid_limit");
    const raised = await api("PUT", `/admin/users/${person.userId}/limits`, { token: boss.accessToken, body: { webCopyMb: 64, fileMb: 50, note: "Thesis with many scans" } });
    expect(raised.json).toMatchObject({ webCopyMb: 64, fileMb: 50, custom: true, note: "Thesis with many scans" });

    const { IdentityRPC } = await import("../src/index");
    const rpc = new IdentityRPC({ waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext, env);
    expect(await rpc.limits({ userId: person.userId })).toEqual({ webCopyBytes: 64 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 });

    const reset = await api("PUT", `/admin/users/${person.userId}/limits`, { token: boss.accessToken, body: { webCopyMb: null, fileMb: null } });
    expect(reset.json.custom).toBe(false);
    const log = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.user.limits' AND target_id = ?1").bind(person.userId).first<{ n: number }>();
    expect(log!.n).toBe(2);
  });
});
