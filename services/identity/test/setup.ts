import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { setEmailSender } from "../src/lib/email";
import { setWebAuthnVerifier } from "../src/lib/webauthn";
import { mailbox, mockWebAuthn } from "./helpers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(() => {
  mailbox.length = 0;
  setEmailSender({ send: async (m) => void mailbox.push(m) });
  setWebAuthnVerifier(mockWebAuthn);
});
