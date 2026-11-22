import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newer } from "../src/routes/updates";
import { api } from "./helpers";

const DL = "https://github.com/justpainful/Worlds/releases/download";
const asset = (tag: string, name: string) => ({ name, size: 10, download_count: 1, browser_download_url: `${DL}/${tag}/${name}` });
const GITHUB = [
  {
    tag_name: "v1.3.0-beta.1",
    published_at: "2026-12-05T00:00:00Z",
    draft: false,
    prerelease: true,
    assets: [asset("v1.3.0-beta.1", "Worlds-1.3.0-beta.1-Windows-x64-setup.exe"), asset("v1.3.0-beta.1", "Worlds-1.3.0-beta.1-Windows-x64-setup.exe.sig")],
  },
  {
    tag_name: "v1.2.0",
    published_at: "2026-12-01T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [asset("v1.2.0", "Worlds-1.2.0-Windows-x64-setup.exe"), asset("v1.2.0", "Worlds-1.2.0-Windows-x64-setup.exe.sig")],
  },
  {
    tag_name: "v1.1.0",
    published_at: "2026-11-23T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [asset("v1.1.0", "Worlds-1.1.0-Windows-x64-setup.exe")],
  },
];

beforeEach(() => {
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.github.com/")) return Response.json(GITHUB);
    if (url.endsWith(".exe.sig")) return new Response("dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==\n");
    return real(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("updates for Worlds on Windows", () => {
  it("offers the newest signed installer, and nothing to an up-to-date app", async () => {
    const r = await api("GET", "/updates/windows/x86_64/1.1.0");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      version: "1.2.0",
      url: `${DL}/v1.2.0/Worlds-1.2.0-Windows-x64-setup.exe`,
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
      notes: "https://changelog.enterworlds.space/1.2.0/",
    });
    expect((await api("GET", "/updates/windows/x86_64/1.2.0")).status).toBe(204);
    expect((await api("GET", "/updates/linux/x86_64/1.0.0")).status).toBe(204);
  });

  it("gives testers the beta channel", async () => {
    const r = await api("GET", "/updates/windows/x86_64/1.2.0", { headers: { "x-worlds-channel": "beta" } });
    expect(r.json.version).toBe("1.3.0-beta.1");
    expect(newer("1.3.0", "1.3.0-beta.1")).toBe(true);
    expect(newer("1.3.0-beta.2", "1.3.0-beta.10")).toBe(false);
    expect(newer("1.2.0", "1.2.0")).toBe(false);
  });
});
