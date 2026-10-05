import { generateKeyPairSync } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// A throwaway signing key for this test run. The public half is served as the
// identity service's JWKS; tests sign tokens with the private half.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KID = "test-key";
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "EdDSA", use: "sig" };
const privateJwk = { ...privateKey.export({ format: "jwk" }), kid: KID };
const JWKS_URL = "https://identity.test/.well-known/jwks.json";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          JWKS_URL,
          INTERNAL_SECRET: "test-internal-secret",
          SYNC_WEBHOOK_SECRET: "test-webhook-secret",
          SIGNING_SECRET: "test-signing-secret",
          COMPACT_EVERY: "5",
          ACCESS_TTL_MS: "1",
          PART_SIZE: String(5 * 1024 * 1024),
          TEST_PRIVATE_JWK: JSON.stringify(privateJwk),
        },
        outboundService: (request: Request) => {
          if (request.url === JWKS_URL) return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "content-type": "application/json" } });
          return new Response("blocked in tests", { status: 502 });
        },
        // Tests change grants through the fake's default fetch handler.
        serviceBindings: { IDENTITY_CONTROL: "worlds-identity" },
        workers: [{ name: "worlds-identity", modules: true, scriptPath: "./test/fake-identity.mjs", compatibilityDate: "2026-08-15" }],
      },
    }),
  ],
  test: {
    testTimeout: 30_000,
  },
});
