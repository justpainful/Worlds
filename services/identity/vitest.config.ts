import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ENVIRONMENT: "test",
            TEST_MIGRATIONS: migrations,
            JWT_PRIVATE_JWK: JSON.stringify(jwk),
            SYNC_WEBHOOK_URL: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
