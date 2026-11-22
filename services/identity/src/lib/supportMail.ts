/**
 * Mail from Worlds support: always from support@<domain>, never from anyone's
 * own address, with replies threaded back to the request through
 * support+<reply key>@<domain> (docs/admin/PLAN.md, phase 2).
 */
import type { Env } from "../env";
import { logEmail } from "./activity";
import { ART, C, DevEmailSender, ResendEmailSender, SITE, emailSender, escape, type EmailLanguage, type EmailMessage, type EmailSender } from "./email";

export const SUPPORT_SITE = "https://support.enterworlds.space";

export function supportAddress(env: Env): string {
  return env.SUPPORT_FROM || `Worlds Support <support@${env.MAIL_INBOX_DOMAIN || "enterworlds.space"}>`;
}

export function replyAddress(env: Env, key: string): string {
  return `support+${key}@${env.MAIL_INBOX_DOMAIN || "enterworlds.space"}`;
}

/**
 * Only a sender that sends from support@ itself. Resend has the domain
 * verified; the edge's Cloudflare sender always uses no-reply@, so it is not
 * used here. Tests and development keep their own sender.
 */
export function supportSender(env: Env): EmailSender {
  if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") return emailSender(env);
  if (env.RESEND_API_KEY) return new ResendEmailSender(env.RESEND_API_KEY, supportAddress(env));
  if (env.ENVIRONMENT !== "production") return new DevEmailSender();
  throw new Error("Support mail needs RESEND_API_KEY");
}

export function ticketRef(number: number): string {
  return `W-${number}`;
}

const COPY = {
  ar: {
    received: (ref: string) => `وصلنا طلبك ${ref}`,
    receivedLead: "شكرًا لك. فريق Worlds يقرأ كل طلب، ونرد عليك هنا وفي التطبيق.",
    reply: (ref: string) => `رد على طلبك ${ref}`,
    replyLead: "كتب لك فريق Worlds:",
    solved: (ref: string) => `انحل طلبك ${ref}`,
    solvedLead: "اعتبرنا طلبك محلولًا. إذا ما انحل، رد على هذه الرسالة ويرجع مفتوحًا.",
    closed: (ref: string) => `أُغلق طلبك ${ref}`,
    closedLead: "أغلقنا الطلب لأنه ما وصلنا رد منذ أسبوع. إذا تحتاج شيئًا، رد على هذه الرسالة.",
    open: "افتح الطلب",
    replyHint: "تقدر ترد على هذه الرسالة مباشرة، ويصل ردك إلى الطلب نفسه.",
    yourRequest: "طلبك:",
    footer: "Worlds يحفظ صفحاتك على جهازك",
    team: "فريق Worlds",
  },
  en: {
    received: (ref: string) => `We got your request ${ref}`,
    receivedLead: "Thank you. The Worlds team reads every request, and we answer here and in the app.",
    reply: (ref: string) => `A reply to your request ${ref}`,
    replyLead: "The Worlds team wrote:",
    solved: (ref: string) => `Your request ${ref} is solved`,
    solvedLead: "We marked your request as solved. If it is not, reply to this email and it opens again.",
    closed: (ref: string) => `Your request ${ref} is closed`,
    closedLead: "We closed the request because we had no answer for a week. If you still need something, reply to this email.",
    open: "Open the request",
    replyHint: "You can reply to this email; your answer goes to the same request.",
    yourRequest: "Your request:",
    footer: "Worlds keeps your pages on your own device",
    team: "The Worlds team",
  },
} as const;

export type SupportMailKind = "received" | "reply" | "solved" | "closed";

/** A short letter in the Worlds mail design: cream paper, cocoa words, one yellow button. */
export function supportMail(
  kind: SupportMailKind,
  t: { number: number; subject: string; lang: string },
  body: string | null,
): { subject: string; text: string; html: string } {
  const lang: EmailLanguage = t.lang === "en" ? "en" : "ar";
  const k = COPY[lang];
  const ref = ticketRef(t.number);
  const subject = { received: k.received, reply: k.reply, solved: k.solved, closed: k.closed }[kind](ref);
  const lead = { received: k.receivedLead, reply: k.replyLead, solved: k.solvedLead, closed: k.closedLead }[kind];
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";
  const sans = ar ? "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif" : "Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
  const serif = ar ? "'Noto Naskh Arabic','Amiri','Traditional Arabic','Times New Roman',serif" : "Georgia,'Iowan Old Style','Times New Roman',serif";
  const size = ar ? 17 : 16;
  const lh = ar ? 1.85 : 1.6;
  const url = `${SUPPORT_SITE}/requests/${t.number}`;
  const para = (s: string) =>
    escape(s)
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, "<br>"))
      .join("<br><br>");
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${escape(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page { background:${C.cocoa} !important; }
    .ink { color:${C.cream} !important; }
    .soft { color:#E9CDB7 !important; }
    .rule { border-color:#6E3B29 !important; }
    .link { color:${C.cream} !important; }
    .quote { background:#5A2A1C !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(`${subject}. ${body ?? lead}`.slice(0, 160))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:${C.cream};">
  <tr><td align="center" style="padding:32px 20px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr"><tr>
          <td valign="middle"><img src="${ART}/worlds.png" width="56" height="56" alt="Worlds" style="display:block;width:56px;height:56px;border:0;border-radius:14px;"></td>
          <td width="22" style="width:22px;"></td>
          <td valign="middle" class="soft" style="color:${C.cocoaSoft};font:400 26px/1 Georgia,serif;">&middot;</td>
          <td width="22" style="width:22px;"></td>
          <td valign="middle"><img src="${ART}/imbue.png" width="130" alt="imbue" style="display:block;width:130px;height:auto;border:0;"></td>
        </tr></table>
      </td></tr>
      <tr><td align="center"><img src="${ART}/letter.png" width="200" alt="" style="display:block;width:200px;max-width:100%;height:auto;border:0;"></td></tr>
      <tr><td align="center" class="ink" style="padding-top:22px;color:${C.cocoa};font:400 ${size + 10}px/1.35 ${serif};">${escape(subject)}</td></tr>
      <tr><td align="center" class="soft" style="padding-top:8px;color:${C.cocoaSoft};font:400 ${size}px/${lh} ${sans};">${escape(lead)}</td></tr>
      ${
        body
          ? `<tr><td style="padding-top:20px;"><div class="quote ink" style="text-align:${align};background:#F4E2CC;border-radius:12px;padding:16px 18px;color:${C.cocoa};font:400 ${size}px/${lh} ${sans};">${para(body)}</div></td></tr>`
          : ""
      }
      <tr><td class="soft" style="padding-top:16px;text-align:${align};color:${C.cocoaSoft};font:400 ${size - 2}px/${lh} ${sans};">${escape(k.yourRequest)} ${escape(ref)} · ${escape(t.subject)}</td></tr>
      <tr><td align="center" style="padding-top:22px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:${C.label};border:3px solid ${C.ink};border-radius:12px;"><a href="${url}" style="display:inline-block;padding:12px 28px;color:${C.ink};font:700 ${size + 1}px/1.4 ${sans};text-decoration:none;">${escape(k.open)}</a></td>
        </tr></table>
      </td></tr>
      <tr><td align="center" class="soft" style="padding-top:12px;color:${C.cocoaSoft};font:400 ${size - 3}px/1.6 ${sans};">${escape(k.replyHint)}</td></tr>
      <tr><td style="padding-top:28px;"><div class="rule" style="border-top:1px solid #E3D3BD;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td align="center" class="soft" style="padding-top:18px;color:${C.cocoaSoft};font:400 ${size - 1}px/${lh} ${serif};">${escape(k.team)}</td></tr>
      <tr><td align="center" class="soft" style="padding-top:14px;color:${C.cocoaSoft};font:400 ${size - 3}px/${lh} ${sans};">${escape(k.footer)} · <a href="${SITE}" class="link" style="color:${C.cocoa};text-decoration:underline;">enterworlds.space</a></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = [subject, "", lead, ...(body ? ["", body] : []), "", `${k.yourRequest} ${ref} · ${t.subject}`, url, "", k.replyHint, "", k.team].join("\n");
  return { subject, text, html };
}

/** Send support mail; a failure is logged, never thrown, so the request itself still saves. */
export async function sendSupportMail(env: Env, msg: EmailMessage): Promise<boolean> {
  try {
    const sender = supportSender(env);
    await sender.send({ ...msg, from: supportAddress(env) });
    await logEmail(env, "support", sender.provider ?? null, true);
    return true;
  } catch (e) {
    console.error("support mail failed", e);
    await logEmail(env, "support", null, false, String(e));
    return false;
  }
}

/** The new part of an email reply: drops the quoted letter below it. */
export function freshPart(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^>/.test(l)) break;
    if (/^(On|في|بتاريخ)\b.*(wrote|كتب)[:،]?\s*$/i.test(l)) break;
    if (/^-{2,}\s*(Original Message|الرسالة الأصلية)/i.test(l)) break;
    if (/^(From|من):\s/.test(l) && out.length) break;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}
