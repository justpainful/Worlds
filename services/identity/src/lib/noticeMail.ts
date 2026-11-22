/**
 * Short notices about the account itself (deletion scheduled, a suspension),
 * from support@ in the Worlds mail design: cream paper, cocoa words, one button.
 */
import { ART, C, SITE, escape, type EmailLanguage } from "./email";
import { SUPPORT_SITE } from "./supportMail";

export type NoticeKind =
  | "deletion_scheduled"
  | "deletion_scheduled_team"
  | "deletion_cancelled"
  | "account_erased"
  | "account_suspended"
  | "account_banned"
  | "suspension_lifted"
  | "content_removed"
  | "team_message"
  | "email_changed_old"
  | "email_changed_new"
  | "profile_changed"
  | "devices_signed_out"
  | "passkey_removed";

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
    deletion_scheduled_team: {
      subject: "حسابك في Worlds مجدول للحذف",
      lead: (v: Vars) => `جدول فريق Worlds حذف حسابك. خرج حسابك من كل أجهزته، واختفى ملفك العام وصفحاتك المنشورة. يُحذف كل شيء نهائيًا في ${v.dateText}.`,
      hint: "إذا ترى أن هذا خطأ، فاعترض من منصة الدعم قبل هذا التاريخ. صفحاتك على جهازك لا تُحذف أبدًا.",
      button: "اعترض على القرار",
      url: `${SUPPORT_SITE}/new/account`,
    },
    account_erased: {
      subject: "حُذف حسابك في Worlds",
      lead: () => "حذف فريق Worlds حسابك نهائيًا، مع ملفك العام وصفحاتك المنشورة وعضويتك في الفرق. صفحاتك على جهازك لا تتأثر.",
      hint: "إذا عندك سؤال عن هذا القرار، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
    },
    email_changed_old: {
      subject: "تغيّر بريد حسابك في Worlds",
      lead: (v: Vars) => `غيّر فريق Worlds البريد المربوط بحسابك إلى ${v.email ?? ""}. من الآن تصل رموز الدخول إلى البريد الجديد، ولا تصل إلى هذا البريد.`,
      hint: "إذا ما طلبت هذا التغيير، راسلنا فورًا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
    },
    email_changed_new: {
      subject: "صار هذا البريد لحسابك في Worlds",
      lead: (v: Vars) => `ربط فريق Worlds هذا البريد بحسابك${v.username ? ` (@${v.username})` : ""}. من الآن تصل رموز الدخول إلى هنا.`,
      hint: "إذا ما تعرف هذا الحساب، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
    },
    profile_changed: {
      subject: "عدّل فريق Worlds حسابك",
      lead: (v: Vars) => `غيّر فريق Worlds ${v.fields ?? ""} في حسابك.`,
      hint: "إذا عندك سؤال عن التغيير، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
    },
    suspension_lifted: {
      subject: "رجع حسابك في Worlds",
      lead: () => "رفع فريق Worlds الإيقاف عن حسابك. تقدر تدخل الآن، ورجع ملفك العام وصفحاتك المنشورة.",
      hint: "شكرًا على صبرك. إذا عندك سؤال، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: SUPPORT_SITE,
    },
    devices_signed_out: {
      subject: "سجّلنا خروج أجهزتك من Worlds",
      lead: (v: Vars) => `سجّل فريق Worlds خروج ${v.title ? `«${v.title}»` : "كل أجهزتك"} من حسابك. صفحاتك على أجهزتك باقية، وتقدر تسجّل دخولك من جديد.`,
      hint: "إذا ما تعرف سبب هذا، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
    },
    passkey_removed: {
      subject: "أُزيل مفتاح دخول من حسابك في Worlds",
      lead: (v: Vars) => `أزال فريق Worlds مفتاح الدخول «${v.title ?? ""}» من حسابك. تقدر تدخل برمز يصلك على البريد، وتضيف مفتاحًا جديدًا من الإعدادات.`,
      hint: "إذا ما تعرف سبب هذا، راسلنا من منصة الدعم.",
      button: "منصة الدعم",
      url: `${SUPPORT_SITE}/new/account`,
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
    deletion_scheduled_team: {
      subject: "Your Worlds account is scheduled for deletion",
      lead: (v: Vars) => `The Worlds team scheduled your account for deletion. It is signed out of every device, and your public profile and published pages are hidden. Everything is erased for good on ${v.dateText}.`,
      hint: "If you think this is a mistake, appeal from the support site before that date. Pages on your device are never deleted.",
      button: "Appeal",
      url: `${SUPPORT_SITE}/new/account`,
    },
    account_erased: {
      subject: "Your Worlds account was deleted",
      lead: () => "The Worlds team deleted your account for good, with your public profile, published pages and Team memberships. Pages on your device are not affected.",
      hint: "If you have a question about this, write to us from the support site.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
    },
    email_changed_old: {
      subject: "The email of your Worlds account changed",
      lead: (v: Vars) => `The Worlds team changed the email of your account to ${v.email ?? ""}. Sign-in codes now go to the new address, not to this one.`,
      hint: "If you did not ask for this, write to us from the support site right away.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
    },
    email_changed_new: {
      subject: "This email is now on your Worlds account",
      lead: (v: Vars) => `The Worlds team linked this address to your account${v.username ? ` (@${v.username})` : ""}. Sign-in codes come here from now on.`,
      hint: "If you do not know this account, write to us from the support site.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
    },
    profile_changed: {
      subject: "The Worlds team changed your account",
      lead: (v: Vars) => `The Worlds team changed ${v.fields ?? ""} on your account.`,
      hint: "If you have a question about the change, write to us from the support site.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
    },
    suspension_lifted: {
      subject: "Your Worlds account is back",
      lead: () => "The Worlds team lifted the suspension on your account. You can sign in now, and your public profile and published pages are back.",
      hint: "Thank you for your patience. If you have a question, write to us from the support site.",
      button: "Support",
      url: SUPPORT_SITE,
    },
    devices_signed_out: {
      subject: "We signed your devices out of Worlds",
      lead: (v: Vars) => `The Worlds team signed ${v.title ? `“${v.title}”` : "all your devices"} out of your account. Your pages stay on your devices, and you can sign in again.`,
      hint: "If you do not know why, write to us from the support site.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
    },
    passkey_removed: {
      subject: "A passkey was removed from your Worlds account",
      lead: (v: Vars) => `The Worlds team removed the passkey “${v.title ?? ""}” from your account. You can sign in with a code sent to your email, and add a new passkey in Settings.`,
      hint: "If you do not know why, write to us from the support site.",
      button: "Support",
      url: `${SUPPORT_SITE}/new/account`,
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
  email?: string;
  username?: string;
  fields?: string;
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
