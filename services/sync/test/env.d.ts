// Bindings visible to tests through `env` from "cloudflare:test".
declare namespace Cloudflare {
  interface Env extends Omit<import("../src/env").Env, never> {
    TEST_PRIVATE_JWK: string;
    IDENTITY_CONTROL: Fetcher;
  }
}
