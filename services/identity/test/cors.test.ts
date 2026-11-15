import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { allowedOrigins } from "../src/index";

const call = async (req: Request, origins: string) => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, ALLOWED_ORIGINS: origins } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

describe("browser access for Worlds on the web", () => {
  it("lets the listed web origin sign in from a browser", async () => {
    const pre = await call(
      new Request("https://login.enterworlds.space/auth/email/start", {
        method: "OPTIONS",
        headers: { origin: "https://go.enterworlds.space", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      }),
      "https://go.enterworlds.space",
    );
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://go.enterworlds.space");
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  it("gives other sites nothing", async () => {
    const res = await call(new Request("https://login.enterworlds.space/", { headers: { origin: "https://evil.example" } }), "https://go.enterworlds.space");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts only https origins, or localhost for development", () => {
    expect(allowedOrigins(" https://go.enterworlds.space/ ,http://evil.example, javascript:alert(1),http://localhost:1433")).toEqual([
      "https://go.enterworlds.space",
      "http://localhost:1433",
    ]);
    expect(allowedOrigins(undefined)).toEqual([]);
  });
});
