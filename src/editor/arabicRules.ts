/**
 * The Arabic spelling rules: common mistakes and how to find them in a text.
 * No editor or interface code, so tests and other tools can use it.
 */
/** Wrong spelling → right spelling. Whole words only. */
export const ARABIC_FIXES: Record<string, string> = {
  "انشاء الله": "إن شاء الله",
  "إنشاء الله": "إن شاء الله",
  "انشالله": "إن شاء الله",
  "ماشاء الله": "ما شاء الله",
  "الى": "إلى",
  "انا": "أنا",
  "انت": "أنت",
  "انتم": "أنتم",
  "اين": "أين",
  "اذا": "إذا",
  "او": "أو",
  "الان": "الآن",
  "امس": "أمس",
  "اسف": "آسف",
  "اولاد": "أولاد",
  "هاذا": "هذا",
  "هاذه": "هذه",
  "هاذي": "هذي",
  "لاكن": "لكن",
  "لاكنه": "لكنه",
  "ذالك": "ذلك",
  "هاكذا": "هكذا",
  "هاؤلاء": "هؤلاء",
  "هاولاء": "هؤلاء",
  "اللذي": "الذي",
  "اللتي": "التي",
  "الذى": "الذي",
  "التى": "التي",
  "فى": "في",
  "حتي": "حتى",
  "متي": "متى",
  "حتا": "حتى",
  "مستشفي": "مستشفى",
  "إبن": "ابن",
  "إسم": "اسم",
  "إثنين": "اثنين",
  "إمرأة": "امرأة",
  "إنتظار": "انتظار",
  "إستخدام": "استخدام",
  "إستعمال": "استعمال",
  "إتصال": "اتصال",
  "إجتماع": "اجتماع",
  "إختبار": "اختبار",
  "إنتهاء": "انتهاء",
  "إستراحة": "استراحة",
  "مسؤل": "مسؤول",
  "شيئ": "شيء",
  "مدرسه": "مدرسة",
  "جامعه": "جامعة",
  "صفحه": "صفحة",
  "ساعه": "ساعة",
  "طريقه": "طريقة",
  "مشكله": "مشكلة",
  "فكره": "فكرة",
  "كلمه": "كلمة",
  "سنه": "سنة",
  "شركه": "شركة",
  "رساله": "رسالة",
  "خطه": "خطة",
  "مهمه": "مهمة",
  "قائمه": "قائمة",
  "مجموعه": "مجموعة",
  "دقيقه": "دقيقة",
  "مقاله": "مقالة",
  "قصه": "قصة",
  "لغه": "لغة",
  "عربيه": "عربية",
  "انجليزيه": "إنجليزية",
  "الانجليزيه": "الإنجليزية",
  "العربيه": "العربية",
  "مراجعه": "مراجعة",
  "محاضره": "محاضرة",
  "جلسه": "جلسة",
  "تجربه": "تجربة",
  "اجابه": "إجابة",
  "اسئله": "أسئلة",
  "مساله": "مسألة",
};

const IGNORE_KEY = "worlds.arabicSpell.ignore";
function ignored(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function ignoreArabicWord(word: string) {
  try {
    localStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored(), word].slice(-500)));
  } catch {
    /* private window */
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PHRASES = Object.keys(ARABIC_FIXES).filter((k) => k.includes(" "));
const PHRASE = new RegExp(`(?<![\\p{L}\\p{M}])(${PHRASES.map(escape).join("|")})(?![\\p{L}\\p{M}])`, "gu");
const WORD = /[\p{L}\p{M}]+/gu;
/** Joined prefixes, longest first: the article and the one-letter particles. */
const PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال", "و", "ب", "ف", "ل", "ك"];

function fixFor(word: string, depth = 0): string | null {
  if (ARABIC_FIXES[word] && !word.includes(" ")) return ARABIC_FIXES[word];
  if (depth > 1) return null;
  for (const p of PREFIXES) {
    if (word.length <= p.length + 2 || !word.startsWith(p)) continue;
    const rest = word.slice(p.length);
    // Only words that take the prefix: "الى" is not "ال" + "ى". Up to two
    // prefixes stack, as in "وبالطريقه".
    const direct = ARABIC_FIXES[rest];
    if (direct && !direct.startsWith("ال") && rest.length > 2) return p + direct;
    const deeper = fixFor(rest, depth + 1);
    if (deeper && rest.length > 2) return p + deeper;
  }
  return null;
}

/** The mistakes in a text, with their offsets. */
export function findArabicMistakes(text: string): { from: number; to: number; word: string; fix: string }[] {
  if (!/[\u0600-\u06FF]/.test(text)) return [];
  const skip = ignored();
  const out: { from: number; to: number; word: string; fix: string }[] = [];
  const taken: [number, number][] = [];
  PHRASE.lastIndex = 0;
  for (let m = PHRASE.exec(text); m; m = PHRASE.exec(text)) {
    if (skip.has(m[1])) continue;
    out.push({ from: m.index, to: m.index + m[1].length, word: m[1], fix: ARABIC_FIXES[m[1]] });
    taken.push([m.index, m.index + m[1].length]);
  }
  WORD.lastIndex = 0;
  for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
    const from = m.index;
    const to = from + m[0].length;
    if (skip.has(m[0]) || taken.some(([a, z]) => from < z && to > a)) continue;
    const fix = fixFor(m[0]);
    if (fix) out.push({ from, to, word: m[0], fix });
  }
  return out.sort((a, z) => a.from - z.from);
}

