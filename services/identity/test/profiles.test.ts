import { describe, expect, it } from "vitest";
import { cleanValue } from "../src/routes/profiles";
import { api, signUp } from "./helpers";

// A 1x1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function named(name: string, username: string) {
  const s = await signUp(name);
  const r = await api("PATCH", "/me", { token: s.accessToken, body: { username } });
  expect(r.status).toBe(200);
  return s;
}

describe("public profiles", () => {
  it("publishes, shows by @username, hides and shows again", async () => {
    const s = await named("Sara", `sara${Date.now().toString(36).slice(-6)}`);
    const me = await api("GET", "/me", { token: s.accessToken });
    const username = me.json.username as string;

    // Nothing published yet: nobody sees anything.
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);
    const before = await api("GET", "/me/public-profile", { token: s.accessToken });
    expect(before.json.published).toBe(false);

    const upload = await api("POST", "/me/public-profile/files", { token: s.accessToken, body: { mime: "image/png", data: PNG } });
    expect(upload.status).toBe(200);
    expect(upload.json.file).toMatch(new RegExp(`^file:p/${s.userId}/[A-Za-z0-9_-]+\\.png$`));

    const put = await api("PUT", "/me/public-profile", {
      token: s.accessToken,
      body: {
        avatar: upload.json.file,
        profile: {
          displayName: "Sara",
          bio: "Designer",
          accent: "#FF5500",
          textDirection: "rtl",
          links: [
            { label: "Site", url: "https://example.com" },
            { label: "Bad", url: "javascript:alert(1)" },
          ],
          blocks: [
            { id: "a", type: "info", size: "6x1", style: "soft", title: "Hello", image: "C:\\Users\\me\\secret.png" },
            { id: "b", type: "quote", size: "6x1", style: "soft", statement: "Hi", hidden: true },
            { id: "c", type: "media", size: "6x1", style: "soft", image: upload.json.file, url: "javascript:x" },
          ],
        },
      },
    });
    expect(put.status).toBe(200);
    expect(put.json.visible).toBe(true);

    const pub = await api("GET", `/profiles/@${username.toUpperCase()}`);
    expect(pub.status).toBe(200);
    expect(pub.json.username).toBe(username);
    expect(pub.json.displayName).toBe("Sara");
    expect(pub.json.accent).toBe("#ff5500");
    expect(pub.json.textDirection).toBe("rtl");
    expect(pub.json.avatar).toBe(upload.json.file);
    // Unsafe links, local paths and hidden blocks never reach visitors.
    expect(pub.json.links).toEqual([{ label: "Site", url: "https://example.com/" }]);
    expect(pub.json.blocks.map((b: { id: string }) => b.id)).toEqual(["a", "c"]);
    expect(pub.json.blocks[0].image).toBeNull();
    expect(pub.json.blocks[1].image).toBe(upload.json.file);
    expect(pub.json.blocks[1].url).toBeNull();
    expect(JSON.stringify(pub.json)).not.toContain("email");

    const file = await api("GET", `/profiles/files/${upload.json.file.slice(5)}`);
    expect(file.status).toBe(200);

    // Hidden reads exactly like no profile, pictures included.
    const hide = await api("PATCH", "/me/public-profile", { token: s.accessToken, body: { visible: false } });
    expect(hide.json.visible).toBe(false);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);
    expect((await api("GET", `/profiles/files/${upload.json.file.slice(5)}`)).status).toBe(404);

    const show = await api("PATCH", "/me/public-profile", { token: s.accessToken, body: { visible: true } });
    expect(show.json.visible).toBe(true);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
  });

  it("follows a new username and refuses other people's files", async () => {
    const a = await named("Ali", `ali${Date.now().toString(36).slice(-6)}`);
    const b = await named("Mona", `mona${Date.now().toString(36).slice(-6)}`);
    const theirs = await api("POST", "/me/public-profile/files", { token: b.accessToken, body: { mime: "image/png", data: PNG } });
    const put = await api("PUT", "/me/public-profile", { token: a.accessToken, body: { banner: theirs.json.file, profile: { blocks: [{ id: "x", type: "media", image: theirs.json.file }] } } });
    expect(put.status).toBe(200);
    expect(put.json.banner).toBeNull();
    expect(put.json.profile.blocks[0].image).toBeNull();

    const renamed = `ali${Date.now().toString(36).slice(-5)}x`;
    await api("PATCH", "/me", { token: a.accessToken, body: { username: renamed } });
    expect((await api("GET", `/profiles/${renamed}`)).status).toBe(200);
  });

  it("needs a sign-in to publish and checks the file type", async () => {
    expect((await api("PUT", "/me/public-profile", { body: { profile: {} } })).status).toBe(401);
    const s = await signUp("Nour");
    const bad = await api("POST", "/me/public-profile/files", { token: s.accessToken, body: { mime: "text/html", data: "PGgxPg==" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("unsupported_file");
  });

  it("keeps only safe values in blocks", () => {
    const v = cleanValue("u1", { title: "x", url: "https://a.b", iconUrl: "data:x", path: "/home/me/a.png", nested: { image: "file:p/u2/abcdefgh.png" }, ok: "file:p/u1/abcdefgh.png" }) as Record<string, unknown>;
    expect(v.url).toBe("https://a.b/");
    expect(v.iconUrl).toBeNull();
    expect(v.path).toBeNull();
    expect((v.nested as Record<string, unknown>).image).toBeNull();
    expect(v.ok).toBe("file:p/u1/abcdefgh.png");
  });
});
