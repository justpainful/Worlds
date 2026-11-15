import { describe, expect, it } from "vitest";
import { clientIp } from "../src/lib/ratelimit";

const req = (headers: Record<string, string>) => new Request("https://identity.test/", { headers });

describe("the visitor's IP behind the edge", () => {
  it("uses the edge's forwarded IP only with the edge secret", () => {
    const viaEdge = req({ "cf-connecting-ip": "198.51.100.1", "x-worlds-edge": "secret-1", "x-worlds-client-ip": "203.0.113.9" });
    expect(clientIp(viaEdge, "secret-1")).toBe("203.0.113.9");
  });

  it("ignores a forged header", () => {
    const forged = req({ "cf-connecting-ip": "198.51.100.1", "x-worlds-edge": "guess", "x-worlds-client-ip": "203.0.113.9" });
    expect(clientIp(forged, "secret-1")).toBe("198.51.100.1");
  });

  it("ignores the header when no edge is configured", () => {
    const sent = req({ "cf-connecting-ip": "198.51.100.1", "x-worlds-edge": "", "x-worlds-client-ip": "203.0.113.9" });
    expect(clientIp(sent, undefined)).toBe("198.51.100.1");
    expect(clientIp(sent, "")).toBe("198.51.100.1");
  });
});
