/**
 * Short notices about the account itself (deletion scheduled, a suspension),
 * from support@ in the Worlds mail design: cream paper, cocoa words, one button.
 */
import { ART, C, SITE, escape, type EmailLanguage } from "./email";
import { SUPPORT_SITE } from "./supportMail";

export type NoticeKind = "deletion_scheduled" | "deletion_cancelled" | "account_suspended" | "account_banned" | "content_removed" | "team_message";

const COPY = {
  ar: {
    deletion_scheduled: {
      subject: "حسابك في Worlds مجدول للحذف",
      lead: (v: Vars) => `طلبت حذف حسابك. خرج حسابك من كل أجهزته، واختفى ملفك العام وصفحاتك المنشورة. يُحذف كل شيء نهائيًا في ${v.dateText}.`,
      hint: "غيرت رأيك؟ سجّل دخولك في Worlds قبل هذا التاريخ واضغط «إلغاء الحذف»، ويرجع كل شيء كما كان. صفحاتك على جهازك لا تُحذف أبدًا.",
      button: "صفحة حذف الحساب",
      url: `${SITE}/docs/account-deletion/`,
    },
    deletion_cancelled: {
      subject: "ألغينا حذف حسابك",
      lead: () => "رجع حسابك كما كان، ورجع ملفك العام وصفحاتك المنشورة.",
      hint: "إذا ما ألغيته أنت، فراسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: SUPPORT_SITE,
    },
    account_suspended: {
      subject: "أوقفنا حسابك في Worlds مؤقتًا",
      lead: (v: Vars) => `أوقف فريق Worlds حسابك حتى ${v.dateText}. خلال هذه المدة لا تقدر تدخل، ويختفي ملفك العام وصفحاتك المنشورة. صفحاتك على جهازك لا تتأثر.`,
      hint: "إذا ترى أن الإيقاف خطأ، فاعترض من منصة الدعم.",
      button: "اعترض على القرار",
      url: `${SUPPORT_SITE}/new/account`,
    },
    account_banned: {
      subject: "حُظر حسابك في Worlds",
      lead: () => "حظر فريق Worlds حسابك لمخالفة شروط الاستخدام. لا تقدر تدخل، واختفى ملفك العام وصفحاتك المنشورة. صفحاتك على جهازك لا تتأثر.",
      hint: "إذا ترى أن الحظر خطأ، فاعترض من منصة الدعم.",
      button: "اعترض على القرار",
      url: `${SUPPORT_SITE}/new/account`,
    },
    content_removed: {
      subject: "أزلنا محتوى نشرته في Worlds",
      lead: (v: Vars) => `أزال فريق Worlds «${v.title ?? ""}» لأنه يخالف سياسة المحتوى.`,
      hint: "إذا ترى أن الإزالة خطأ، فاعترض من منصة الدعم.",
      button: "اعترض على القرار",
      url: `${SUPPORT_SITE}/new/report`,
    },
    team_message: {
      subject: "رسالة من فريق Worlds",
      lead: () => "كتب لك فريق Worlds:",
      hint: "ترد عليها من التطبيق، أو من منصة الدعم.",
      button: "منصة الدعم",
      url: SUPPORT_SITE,
    },
    reason: "السبب:",
    footer: "Worlds يحفظ صفحاتك على جهازك",
    team: "فريق Worlds",
  },
  en: {
    deletion_scheduled: {
      subject: "Your Worlds account is scheduled for deletion",
      lead: (v: Vars) => `You asked to delete your account. It is signed out of every device, and your public profile and published pages are hidden. Everything is erased for good on ${v.dateText}.`,
      hint: "Changed your mind? Sign in to Worlds before that date and choose Cancel deletion; everything comes back as it was. Pages on your device are never deleted.",
      button: "Account deletion",
      url: `${SITE}/en/docs/account-deletion/`,
    },
    deletion_cancelled: {
      subject: "We cancelled your account deletion",
      lead: () => "Your account is back as it was, with your public profile and published pages.",
      hint: "If it was not you who cancelled it, write to us from the support site.",
      button: "Support",
      url: SUPPORT_SITE,
    },
    account_suspended: {
      subject: "Your Worlds account is suspended for now",
      lead: (v: Vars) => `The Worlds team suspended your account until ${v.dateText}. Until then you cannot sign in, and your public profile and published pages are hidden. Pages on your device are not affected.`,
      hint: "If you think this is a mistake, appeal from the support site.",
      button: "Appeal",
      url: `${SUPPORT_SITE}/new/account`,
    },
    account_banned: {
      subject: "Your Worlds account is banned",
      lead: () => "The Worlds team banned your account for breaking the terms of use. You cannot sign in, and your public profile and published pages are hidden. Pages on your device are not affected.",
      hint: "If you think this is a mistake, appeal from the support site.",
      button: "Appeal",
      url: `${SUPPORT_SITE}/new/account`,
    },
    content_removed: {
      subject: "We removed something you published on Worlds",
      lead: (v: Vars) => `The Worlds team removed “${v.title ?? ""}” because it breaks the content policy.`,
      hint: "If you think this is a mistake, appeal from the support site.",
      button: "Appeal",
      url: `${SUPPORT_SITE}/new/report`,
    },
    team_message: {
      subject: "A message from the Worlds team",
      lead: () => "The Worlds team wrote to you:",
      hint: "Reply from the app, or from the support site.",
      button: "Support",
      url: SUPPORT_SITE,
    },
    reason: "Reason:",
    footer: "Worlds keeps your pages on your own device",
    team: "The Worlds team",
  },
} as const;

interface Vars {
  date?: number;
  dateText?: string;
  title?: string;
  reason?: string;
  body?: string;
}

export function noticeMail(lang: EmailLanguage, kind: NoticeKind, v: Vars = {}): { subject: string; text: string; html: string } {
  const k = COPY[lang];
  const n = k[kind];
  const vars: Vars = { ...v, dateText: v.date ? new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en-GB", { dateStyle: "long" }).format(v.date) : undefined };
  const lead = n.lead(vars);
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";
  const sans = ar ? "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif" : "Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
  const serif = ar ? "'Noto Naskh Arabic','Amiri','Traditional Arabic','Times New Roman',serif" : "Georgia,'Iowan Old Style','Times New Roman',serif";
  const size = ar ? 17 : 16;
  const lh = ar ? 1.85 : 1.6;
  const quote = v.body ?? (v.reason ? `${k.reason} ${v.reason}` : null);
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(n.subject)}</title>
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:${C.cream};">
  <tr><td align="center" style="padding:32px 20px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:22px;"><img src="${ART}/worlds.png" width="56" height="56" alt="Worlds" style="display:block;width:56px;height:56px;border:0;border-radius:14px;"></td></tr>
      <tr><td align="center"><img src="${ART}/padlock.png" width="120" alt="" style="display:block;width:120px;max-width:100%;height:auto;border:0;"></td></tr>
      <tr><td align="center" class="ink" style="padding-top:20px;color:${C.cocoa};font:400 ${size + 9}px/1.35 ${serif};">${escape(n.subject)}</td></tr>
      <tr><td class="ink" style="padding-top:12px;text-align:${align};color:${C.cocoa};font:400 ${size}px/${lh} ${sans};">${escape(lead)}</td></tr>
      ${quote ? `<tr><td style="padding-top:14px;"><div class="quote ink" style="text-align:${align};background:#F4E2CC;border-radius:12px;padding:14px 16px;color:${C.cocoa};font:400 ${size}px/${lh} ${sans};white-space:pre-wrap;">${escape(quote)}</div></td></tr>` : ""}
      <tr><td class="soft" style="padding-top:14px;text-align:${align};color:${C.cocoaSoft};font:400 ${size - 1}px/${lh} ${sans};">${escape(n.hint)}</td></tr>
      <tr><td align="center" style="padding-top:22px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:${C.label};border:3px solid ${C.ink};border-radius:12px;"><a href="${n.url}" style="display:inline-block;padding:12px 28px;color:${C.ink};font:700 ${size + 1}px/1.4 ${sans};text-decoration:none;">${escape(n.button)}</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding-top:28px;"><div class="rule" style="border-top:1px solid #E3D3BD;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td align="center" class="soft" style="padding-top:16px;color:${C.cocoaSoft};font:400 ${size - 1}px/${lh} ${serif};">${escape(k.team)}</td></tr>
      <tr><td align="center" class="soft" style="padding-top:12px;color:${C.cocoaSoft};font:400 ${size - 3}px/${lh} ${sans};">${escape(k.footer)} · <a href="${SITE}" class="link" style="color:${C.cocoa};text-decoration:underline;">enterworlds.space</a></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = [n.subject, "", lead, ...(quote ? ["", quote] : []), "", n.hint, n.url, "", k.team].join("\n");
  return { subject: n.subject, text, html };
}
