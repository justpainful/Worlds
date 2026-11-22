import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, lastCode, mailbox, signUp, uniqueEmail } from "./helpers";

async function owner() {
  const boss = await signUp("Notices Owner");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");
  const start = await api("POST", "/auth/email/start", { body: { email: boss.email } });
  await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(boss.email) } });
  return boss;
}

const to = (email: string) => mailbox.filter((m) => m.to === email);

describe("the person hears about changes the team makes", () => {
  it("emails the old and the new address when the team changes the email, unless told not to", async () => {
    const boss = await owner();
    const person = await signUp("Email Mover");
    const fresh = uniqueEmail();
    const r = await api("PATCH", `/admin/users/${person.userId}`, { token: boss.accessToken, body: { email: fresh, reason: "Asked by support request W-1001", lang: "en" } });
    expect(r.status).toBe(200);
    const old = to(person.email).at(-1)!;
    expect(old.subject).toBe("The email of your Worlds account changed");
    // The old address sees only a masked new one.
    expect(old.text).not.toContain(fresh);
    expect(old.text).toContain(`${fresh[0]}**`);
    expect(to(fresh).at(-1)!.subject).toBe("This email is now on your Worlds account");
    expect(old.from).toContain("support@");

    const quiet = uniqueEmail();
    const before = mailbox.length;
    await api("PATCH", `/admin/users/${person.userId}`, { token: boss.accessToken, body: { email: quiet, reason: "Typo fix", notify: false } });
    expect(mailbox.length).toBe(before);
  });

  it("names the changed fields, and tells about lifted suspensions and signed-out devices", async () => {
    const boss = await owner();
    const person = await signUp("Renamed Person");
    await api("PATCH", `/admin/users/${person.userId}`, { token: boss.accessToken, body: { displayName: "New Name", reason: "Impersonation" } });
    const changed = to(person.email).at(-1)!;
    expect(changed.subject).toBe("عدّل فريق Worlds حسابك");
    expect(changed.text).toContain("الاسم");

    await api("POST", `/admin/users/${person.userId}/suspend`, { token: boss.accessToken, body: { days: 1, reason: "Spam" } });
    await api("POST", `/admin/users/${person.userId}/unsuspend`, { token: boss.accessToken, body: { reason: "Appeal accepted" } });
    expect(to(person.email).at(-1)!.subject).toBe("رجع حسابك في Worlds");

    const other = await signUp("Signed Out Person");
    await api("POST", `/admin/users/${other.userId}/signout`, { token: boss.accessToken, body: { reason: "Lost phone" } });
    expect(to(other.email).at(-1)!.subject).toBe("سجّلنا خروج أجهزتك من Worlds");
  });

  it("tells about deletion by the team and its cancelling", async () => {
    const boss = await owner();
    const person = await signUp("Deleted By Team");
    await api("POST", `/admin/users/${person.userId}/delete`, { token: boss.accessToken, body: { reason: "Asked by email", lang: "en" } });
    expect(to(person.email).at(-1)!.text).toContain("The Worlds team scheduled your account for deletion");
    await api("POST", `/admin/users/${person.userId}/deletion/cancel`, { token: boss.accessToken, body: { lang: "en" } });
    expect(to(person.email).at(-1)!.subject).toBe("We cancelled your account deletion");
  });
});
