import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "../src/lib/terms";
import { api, lastCode, signUp, uniqueEmail } from "./helpers";

describe("accepting the terms", () => {
  it("keeps the version accepted at sign-up, and a newer one accepted later", async () => {
    const email = uniqueEmail("terms");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    const made = await api("POST", "/auth/email/verify", {
      body: { challengeId: start.json.challengeId, code: lastCode(email), displayName: "Terms Reader", terms: TERMS_VERSION, device: { name: "Test PC", platform: "windows" } },
    });
    expect(made.json.created).toBe(true);
    expect(made.json.user.termsVersion).toBe(TERMS_VERSION);

    const config = await api("GET", "/config");
    expect(config.json.terms.version).toBe(TERMS_VERSION);

    const old = await signUp("No Terms Yet");
    expect((await api("GET", "/me", { token: old.accessToken })).json.termsVersion).toBeNull();
    expect((await api("POST", "/me/terms", { token: old.accessToken, body: { version: "2000-01-01" } })).json.error).toBe("terms_outdated");
    expect((await api("POST", "/me/terms", { token: old.accessToken, body: { version: TERMS_VERSION } })).status).toBe(200);
    expect((await api("GET", "/me", { token: old.accessToken })).json.termsVersion).toBe(TERMS_VERSION);
  });
});
