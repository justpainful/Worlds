import { useSyncExternalStore } from "react";

export type Lang = "ar" | "en";

const ar = {
  title: "دعم Worlds",
  heroTitle: "كيف نقدر نساعدك؟",
  heroLead: "ابحث في مقالات المساعدة، أو أرسل طلبًا لفريق Worlds.",
  searchPlaceholder: "اكتب مشكلتك أو سؤالك",
  noArticles: "ما لقينا مقالة تطابق. جرّب كلمات أخرى، أو أرسل طلبًا.",
  newRequest: "أرسل طلبًا",
  myRequests: "طلباتي",
  popular: "مقالات تساعد كثيرًا",
  chooseKind: "وش نوع طلبك؟",
  chooseKindLead: "اختر الأقرب، وتطلع لك الأسئلة المناسبة له.",
  orWrite: "أو راسلنا على",
  readArticle: "اقرأ المقالة",
  maybeHelps: "يمكن تحل مشكلتك هذه المقالات:",
  kind_problem: "مشكلة في التطبيق",
  kind_problem_d: "شيء لا يعمل، أو يتوقف، أو يظهر خطأ.",
  kind_account: "الحساب وتسجيل الدخول",
  kind_account_d: "الرمز ما يصل، مفتاح الدخول، الاسم أو اسم المستخدم.",
  kind_recovery: "استعادة حساب مفقود",
  kind_recovery_d: "فقدت بريدك ومفاتيح دخولك وتبي ترجع لحسابك.",
  kind_deletion: "حذف الحساب وبياناتي",
  kind_deletion_d: "حذف الحساب، أو تنزيل بياناتك، أو مسح نسختك على الويب.",
  kind_report: "الإبلاغ عن محتوى أو شخص",
  kind_report_d: "صفحة منشورة أو ملف عام فيه إساءة أو انتحال أو مخالفة.",
  kind_security: "ثغرة أمنية",
  kind_security_d: "طلب خاص لا يراه إلا مالكو Worlds.",
  kind_suggestion: "اقتراح",
  kind_suggestion_d: "فكرة تبيها في Worlds.",
  kind_other: "شيء آخر",
  kind_other_d: "أي سؤال أو طلب ثاني.",
  subject: "الموضوع",
  subjectHint: "سطر واحد يوصف طلبك.",
  description: "الوصف",
  descriptionHint: "اكتب التفاصيل اللي تساعدنا نفهم. لا تكتب كلمات مرور أو رموز دخول أبدًا.",
  attachments: "صور",
  attachHint: "حتى 6 صور، كل وحدة حتى 10 ميغابايت.",
  addPicture: "أضف صورة",
  removePicture: "إزالة الصورة",
  yourEmail: "بريدك",
  yourEmailHint: "نرسل لك رمزًا لتأكيده، ونرد عليك عليه.",
  sendCode: "أرسل الرمز",
  code: "الرمز",
  codeSent: "أرسلنا رمزًا من 6 أرقام إلى {email}.",
  confirm: "تأكيد",
  confirmedAs: "بريدك: {email}",
  change: "تغيير",
  submit: "أرسل الطلب",
  sentTitle: "وصلنا طلبك {ref}",
  sentLead: "أرسلنا لك إيميلًا من support@enterworlds.space فيه رقم الطلب. نرد عليك هناك، وفي التطبيق إن كان عندك حساب.",
  openRequest: "افتح الطلب",
  backHome: "الرئيسية",
  back: "رجوع",
  signInLead: "أكد بريدك لتشوف طلباتك.",
  signOut: "خروج",
  noRequests: "ما عندك طلبات بهذا البريد.",
  st_open: "مفتوح",
  st_waiting: "ينتظر ردك",
  st_working: "قيد العمل",
  st_solved: "محلول",
  st_closed: "مغلق",
  you: "أنت",
  team: "فريق Worlds",
  systemClosed: "أُغلق تلقائيًا بعد أسبوع بلا رد. اكتب ردًا ليرجع مفتوحًا.",
  writeReply: "اكتب ردك",
  sendReply: "إرسال",
  solvedQ: "هل انحلت مشكلتك؟",
  yes: "نعم، انحلت",
  no: "لا، ما انحلت",
  thanks: "شكرًا لك.",
  required: "مطلوب",
  optional: "اختياري",
  f_platform: "النظام",
  f_version: "إصدار Worlds",
  f_versionHint: "من الإعدادات، حول Worlds. مثل 1.0.1",
  f_steps: "وش سويت قبل ما تصير المشكلة؟",
  f_expected: "وش كنت تتوقع يصير؟",
  f_username: "اسم المستخدم",
  f_issue: "وش المشكلة؟",
  issue_code: "رمز الدخول ما يوصل",
  issue_passkey: "مفتاح الدخول ما يشتغل",
  issue_name: "اسمي أو اسم المستخدم تغير",
  issue_signin: "ما أقدر أدخل",
  issue_other: "شيء ثاني",
  f_oldEmail: "البريد القديم للحساب",
  f_devices: "الأجهزة اللي كنت تستخدم Worlds عليها",
  f_joined: "متى سجلت تقريبًا؟",
  f_workspaces: "أسماء مساحاتك أو صفحاتك المنشورة",
  recoveryNote: "هذا البريد (اللي بتأكده الحين) هو الجديد اللي نرجع له الحساب بعد ما نتحقق.",
  f_request: "وش تبي؟",
  req_delete: "حذف حسابي",
  req_export: "تنزيل نسخة من بياناتي",
  req_web: "مسح نسختي على الويب فقط",
  f_link: "رابط المحتوى",
  f_reason: "السبب",
  reason_abuse: "إساءة أو تحرش",
  reason_impersonation: "انتحال شخصية",
  reason_illegal: "محتوى مخالف للقانون",
  reason_scam: "احتيال أو روابط ضارة",
  reason_copyright: "حقوق نشر",
  reason_other: "شيء آخر",
  securityNote: "هذا الطلب خاص ولا يراه إلا مالكو Worlds. اكتب الخطوات بالتفصيل، ولا تجرب الثغرة على حسابات غيرك.",
  ideasTitle: "الاقتراحات",
  ideasLead: "أفكار الناس لـ Worlds. صوّت للي تبيها، أو اقترح فكرة جديدة. الفريق يراجع كل فكرة قبل ما تظهر هنا.",
  newIdea: "اقترح فكرة",
  ideaTitle: "الفكرة في سطر",
  sendIdea: "أرسل الاقتراح",
  ideaSent: "وصلنا اقتراحك. يظهر هنا بعد ما يراجعه الفريق.",
  mostVoted: "الأكثر تصويتًا",
  newest: "الأحدث",
  noIdeas: "ما فيه اقتراحات معروضة بعد.",
  vote: "صوّت",
  voteSignIn: "أكد بريدك من «طلباتي» لتصوّت.",
  votesN: "{n} صوت",
  teamNote: "من الفريق",
  idea_new: "جديد",
  idea_planned: "مخطط له",
  idea_working: "قيد العمل",
  idea_shipped: "نزل",
  roadmap: "خارطة الطريق",
  roadmapLead: "وش يشتغل عليه فريق Worlds، ووش نزل، من اقتراحاتكم.",
  nothingYet: "ما فيه شيء هنا بعد.",
  ideasNav: "الاقتراحات",
  roadmapNav: "خارطة الطريق",
  theme: "المظهر",
  language: "English",
  error_offline: "تعذر الوصول إلى الخدمة. تأكد من الاتصال.",
  error_invalid_code: "الرمز غير صحيح.",
  error_code_expired: "انتهى الرمز. اطلب رمزًا جديدًا.",
  error_rate_limited: "محاولات كثيرة. انتظر قليلًا.",
  error_too_large: "الصورة أكبر من 10 ميغابايت.",
  error_invalid_type: "الصور فقط: PNG أو JPEG أو WebP أو GIF.",
  error_request_not_found: "ما فيه طلب بهذا الرقم لبريدك.",
  errorGeneric: "صار خطأ: {message}",
  footer: "Worlds يحفظ صفحاتك على جهازك",
  privacy: "الخصوصية",
  terms: "الشروط",
  site: "الموقع",
  status: "حالة الخدمات",
};

type Dict = Record<keyof typeof ar, string>;

const en: Dict = {
  title: "Worlds Support",
  heroTitle: "How can we help?",
  heroLead: "Search the help articles, or send a request to the Worlds team.",
  searchPlaceholder: "Describe your problem or question",
  noArticles: "No article matches. Try other words, or send a request.",
  newRequest: "Send a request",
  myRequests: "My requests",
  popular: "Articles that help most",
  chooseKind: "What is your request about?",
  chooseKindLead: "Pick the closest one, and you get the questions that fit it.",
  orWrite: "Or write to",
  readArticle: "Read the article",
  maybeHelps: "These articles might solve it:",
  kind_problem: "A problem in the app",
  kind_problem_d: "Something does not work, stops, or shows an error.",
  kind_account: "Account and sign-in",
  kind_account_d: "The code does not arrive, passkeys, your name or username.",
  kind_recovery: "Recover a lost account",
  kind_recovery_d: "You lost your email and passkeys and want your account back.",
  kind_deletion: "Account deletion and my data",
  kind_deletion_d: "Delete the account, download your data, or erase your web copy.",
  kind_report: "Report content or a person",
  kind_report_d: "A published page or public profile with abuse, impersonation or a breach.",
  kind_security: "Security issue",
  kind_security_d: "A private request that only the Worlds owners see.",
  kind_suggestion: "Suggestion",
  kind_suggestion_d: "An idea you want in Worlds.",
  kind_other: "Something else",
  kind_other_d: "Any other question or request.",
  subject: "Subject",
  subjectHint: "One line about your request.",
  description: "Description",
  descriptionHint: "Write the details that help us understand. Never write passwords or sign-in codes.",
  attachments: "Pictures",
  attachHint: "Up to 6 pictures, each up to 10 MB.",
  addPicture: "Add a picture",
  removePicture: "Remove the picture",
  yourEmail: "Your email",
  yourEmailHint: "We send a code to confirm it, and we answer you there.",
  sendCode: "Send the code",
  code: "Code",
  codeSent: "We sent a 6-digit code to {email}.",
  confirm: "Confirm",
  confirmedAs: "Your email: {email}",
  change: "Change",
  submit: "Send the request",
  sentTitle: "We got your request {ref}",
  sentLead: "We sent you an email from support@enterworlds.space with its number. We answer there, and in the app if you have an account.",
  openRequest: "Open the request",
  backHome: "Home",
  back: "Back",
  signInLead: "Confirm your email to see your requests.",
  signOut: "Sign out",
  noRequests: "You have no requests with this email.",
  st_open: "Open",
  st_waiting: "Waiting for you",
  st_working: "In progress",
  st_solved: "Solved",
  st_closed: "Closed",
  you: "You",
  team: "The Worlds team",
  systemClosed: "Closed by itself after a week with no answer. Reply to open it again.",
  writeReply: "Write your reply",
  sendReply: "Send",
  solvedQ: "Is your problem solved?",
  yes: "Yes, it is solved",
  no: "No, it is not",
  thanks: "Thank you.",
  required: "Required",
  optional: "Optional",
  f_platform: "System",
  f_version: "Worlds version",
  f_versionHint: "In Settings, About Worlds. For example 1.0.1",
  f_steps: "What did you do before it happened?",
  f_expected: "What did you expect?",
  f_username: "Username",
  f_issue: "What is the problem?",
  issue_code: "The sign-in code does not arrive",
  issue_passkey: "My passkey does not work",
  issue_name: "My name or username changed",
  issue_signin: "I cannot sign in",
  issue_other: "Something else",
  f_oldEmail: "The account's old email",
  f_devices: "Devices you used Worlds on",
  f_joined: "When did you join, roughly?",
  f_workspaces: "Names of your workspaces or published pages",
  recoveryNote: "The email you confirm now is the new one we move the account to, once we have checked.",
  f_request: "What do you want?",
  req_delete: "Delete my account",
  req_export: "Download a copy of my data",
  req_web: "Erase only my web copy",
  f_link: "Link to the content",
  f_reason: "Reason",
  reason_abuse: "Abuse or harassment",
  reason_impersonation: "Impersonation",
  reason_illegal: "Illegal content",
  reason_scam: "Scam or harmful links",
  reason_copyright: "Copyright",
  reason_other: "Something else",
  securityNote: "This request is private; only the Worlds owners see it. Write the steps in detail, and do not try the issue on other people's accounts.",
  ideasTitle: "Suggestions",
  ideasLead: "People's ideas for Worlds. Vote for the ones you want, or suggest a new one. The team reviews every idea before it shows here.",
  newIdea: "Suggest an idea",
  ideaTitle: "The idea in one line",
  sendIdea: "Send the suggestion",
  ideaSent: "We got your suggestion. It shows here once the team has reviewed it.",
  mostVoted: "Most voted",
  newest: "Newest",
  noIdeas: "No suggestions on the board yet.",
  vote: "Vote",
  voteSignIn: "Confirm your email in My requests to vote.",
  votesN: "{n} votes",
  teamNote: "From the team",
  idea_new: "New",
  idea_planned: "Planned",
  idea_working: "In progress",
  idea_shipped: "Shipped",
  roadmap: "Roadmap",
  roadmapLead: "What the Worlds team is working on and what has shipped, from your suggestions.",
  nothingYet: "Nothing here yet.",
  ideasNav: "Suggestions",
  roadmapNav: "Roadmap",
  theme: "Appearance",
  language: "العربية",
  error_offline: "The service could not be reached. Check the connection.",
  error_invalid_code: "That code is not right.",
  error_code_expired: "That code expired. Ask for a new one.",
  error_rate_limited: "Too many tries. Wait a little.",
  error_too_large: "The picture is larger than 10 MB.",
  error_invalid_type: "Pictures only: PNG, JPEG, WebP or GIF.",
  error_request_not_found: "There is no request with that number for your email.",
  errorGeneric: "Something went wrong: {message}",
  footer: "Worlds keeps your pages on your own device",
  privacy: "Privacy",
  terms: "Terms",
  site: "Website",
  status: "Service status",
};

export type Key = keyof typeof ar;
const DICTS: Record<Lang, Dict> = { ar, en };

function initial(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ar" || q === "en") {
    try {
      localStorage.setItem("worlds.support.lang", q);
    } catch {
      // This visit only.
    }
    return q;
  }
  try {
    const saved = localStorage.getItem("worlds.support.lang");
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    // Follow the browser.
  }
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

let lang: Lang = initial();
const subs = new Set<() => void>();
function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = DICTS[lang].title;
}
apply();

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem("worlds.support.lang", l);
  } catch {
    // This visit only.
  }
  apply();
  for (const s of subs) s();
}
export const getLang = () => lang;

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => lang,
  );
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = DICTS[lang][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

export function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const key = `error_${code}` as Key;
  if (code && key in ar) return t(key);
  return t("errorGeneric", { message: (e as Error)?.message ?? String(e) });
}

const locale = () => (lang === "ar" ? "ar-u-nu-latn" : "en-GB");
export const fmtDate = (ms: number) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);
