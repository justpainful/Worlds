import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { block, directionOf, fileSrc, handleProfile, linkLabel, renderProfile, safeHref, type PublicProfile } from "../src/profile";

const sample = (over: Partial<PublicProfile> = {}): PublicProfile => ({
  username: "sara",
  displayName: "Sara",
  bio: "Designer <b>bold</b>",
  status: null,
  location: "Riyadh",
  accent: "#ff5500",
  theme: "auto",
  textDirection: "auto",
  language: "en",
  links: [
    { label: "", url: "https://github.com/sara" },
    { label: "Evil", url: "javascript:alert(1)" },
  ],
  blocks: [{ id: "a", type: "info", size: "6x1", style: "soft", title: "<script>x</script>", image: "file:p/u-1/abcdefgh12.png" }],
  bannerFocus: "50,30",
  avatarCrop: null,
  avatar: "file:p/u-1/abcdefgh12.png",
  banner: null,
  joinedAt: Date.UTC(2026, 10, 1),
  updatedAt: 0,
  ...over,
});

describe("public profile page", () => {
  it("escapes what people write and keeps only safe links", () => {
    const html = renderProfile(sample(), "https://profile.enterworlds.space", "https://enterworlds.space");
    expect(html).toContain("Designer &lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://github.com/sara"');
    expect(html).toContain("<span>GitHub</span>");
    expect(html).toContain('<meta property="og:image" content="https://profile.enterworlds.space/files/p/u-1/abcdefgh12.png">');
    expect(html).toContain("@sara");
    expect(html).toContain("--accent:#ff5500");
  });

  it("reads Arabic profiles right to left", () => {
    expect(directionOf({ textDirection: "auto", displayName: "سارة", bio: null })).toBe("rtl");
    expect(directionOf({ textDirection: "ltr", displayName: "سارة", bio: null })).toBe("ltr");
    const html = renderProfile(sample({ displayName: "سارة", language: "ar" }), "https://profile.enterworlds.space", "https://enterworlds.space");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("انضم نوفمبر 2026");
  });

  it("refuses paths and other people's keys as files", () => {
    expect(fileSrc("file:p/u-1/abcdefgh12.png")).toBe("/files/p/u-1/abcdefgh12.png");
    expect(fileSrc("file:../secret")).toBeNull();
    expect(fileSrc("C:\\Users\\me.png")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(linkLabel({ label: "", url: "https://x.com/sara" })).toBe("X");
    expect(block({ type: "dynamic", source: "streak" })).toBe("");
    expect(block({ type: "media", media: "/etc/passwd" })).toBe("");
  });

  it("answers /@name, redirects /name, and shows a hidden profile as missing", async () => {
    const calls: string[] = [];
    const call = async (path: string) => {
      calls.push(path);
      if (path === "/profiles/sara") return Response.json(sample());
      return Response.json({ error: "profile_not_found" }, { status: 404 });
    };
    const get = (p: string) => handleProfile(new Request(`https://profile.enterworlds.space${p}`), {}, call);
    const ok = await get("/@sara");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await ok.text()).toContain('<h1 class="pf-name">Sara</h1>');
    expect(ok.headers.get("content-security-policy")).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    const redirect = await get("/Sara");
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("https://profile.enterworlds.space/@sara");
    const hidden = await get("/@nobody");
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toContain("No profile here");
    expect((await get("/")).status).toBe(200);
    expect((await handleProfile(new Request("https://profile.enterworlds.space/@sara", { method: "POST" }), {}, call)).status).toBe(405);
    expect(calls).toEqual(["/profiles/sara", "/profiles/nobody"]);
  });

  it("is only served on the profile host", async () => {
    const env: Env = {
      IDENTITY_ORIGIN: "https://worlds-identity.test.workers.dev",
      SYNC_ORIGIN: "https://worlds-sync.test.workers.dev",
      LOGIN_HOST: "login.enterworlds.space",
      CONNECT_HOST: "connect.enterworlds.space",
      PROFILE_HOST: "profile.enterworlds.space",
      MAIL_FROM: "Worlds <no-reply@enterworlds.space>",
      EDGE_SECRET: "edge-secret-0123456789",
      MAIL_SECRET: "mail-secret-0123456789",
    };
    const home = await worker.fetch(new Request("https://profile.enterworlds.space/"), env);
    expect(home.status).toBe(200);
    expect((await worker.fetch(new Request("https://other.enterworlds.space/@sara"), env)).status).toBe(404);
  });
});
