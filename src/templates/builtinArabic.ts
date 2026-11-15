/**
 * Arabic versions of the built-in page templates (src-tauri/src/templates.rs).
 * The templates are seeded once in English and then are the person's own pages,
 * so the Arabic interface shows these names, and a page made from a template the
 * person has not renamed or edited is written in Arabic from the same structure.
 */
import type { PageMeta } from "../lib/types";

interface ArabicTemplate {
  /** The title the template was seeded with, so a renamed one is left alone. */
  en: string;
  title: string;
  description: string;
  markdown: string;
}

export const ARABIC_TEMPLATES: ArabicTemplate[] = [
  {
    en: "To-do List",
    title: "قائمة مهام",
    description: "اليوم، وهذا الأسبوع، ويومًا ما.",
    markdown: `## اليوم
- [ ]
## هذا الأسبوع
- [ ]
## يومًا ما
- [ ]
---
> [!note] انقل ما تنجزه إلى الأسفل أولًا بأول، واترك أعلى الصفحة لما هو قادم.`,
  },
  {
    en: "Project Tracker",
    title: "متابعة مشروع",
    description: "الهدف والمراحل والمسؤولون والحالة في مكان واحد.",
    markdown: `> [!note] **الهدف**: جملة واحدة تصف شكل الإنجاز.

## المراحل
| المرحلة | المسؤول | الموعد | الحالة |
|---|---|---|---|
| الاتفاق على النطاق |  | {{date}} | لم تبدأ |
|  |  |  |  |

## أسئلة مفتوحة
-

## قرارات
-

## المهام
- [ ]`,
  },
  {
    en: "Weekly Update {{date}}",
    title: "تحديث أسبوعي {{date}}",
    description: "ما أُنجز، وما التالي، وما يعيقنا.",
    markdown: `## ما أُنجز
-

## التالي
-

## ما يعيقنا
-

## ملاحظات`,
  },
  {
    en: "Feedback Tracker",
    title: "متابعة الملاحظات",
    description: "اجمع الملاحظات وقرر ما تعمل عليه.",
    markdown: `| من | الملاحظة | الجانب | الأولوية | الإجراء |
|---|---|---|---|---|
|  |  |  |  |  |

## محاور متكررة
-

## نعمل عليه
- [ ]`,
  },
  {
    en: "Release Notes",
    title: "ملاحظات الإصدار",
    description: "الإصدار، وأبرز ما فيه، والإصلاحات، والمشكلات المعروفة.",
    markdown: `**الإصدار** v1.0.0 · **التاريخ** {{date}}

## أبرز ما فيه
-

## تحسينات
-

## إصلاحات
-

## مشكلات معروفة
-`,
  },
  {
    en: "Meeting Notes",
    title: "ملاحظات اجتماع",
    description: "جدول الأعمال والقرارات والمهام.",
    markdown: `**التاريخ** {{date}} · **الوقت**

## الحضور
-

## جدول الأعمال
1.

## القرارات
-

## المهام
- [ ]`,
  },
  {
    en: "Roadmap",
    title: "خارطة الطريق",
    description: "الآن، والتالي، ولاحقًا.",
    markdown: `## الآن
| العنصر | السبب | المسؤول |
|---|---|---|
|  |  |  |

## التالي
| العنصر | السبب | المسؤول |
|---|---|---|
|  |  |  |

## لاحقًا
-

> [!note] أعد ترتيب هذه الصفحة كل أسبوعين. ما لم يتحرك منذ شهر ينتقل إلى «لاحقًا».`,
  },
  {
    en: "Bug Tracker",
    title: "متابعة الأخطاء",
    description: "أعد إنتاج الخطأ، ورتّب أولويته، وأصلحه.",
    markdown: `| الخطأ | الخطوات | الخطورة | الحالة | المسؤول |
|---|---|---|---|---|
|  |  | عالية | مفتوح |  |

## قواعد الفرز
- **عالية**: فقدان بيانات، أو توقف التطبيق، أو تعطل مسار أساسي.
- **متوسطة**: سلوك خاطئ له حل بديل.
- **منخفضة**: شكلية.`,
  },
  {
    en: "Discord Announcement",
    title: "إعلان Discord",
    description: "رسالة منظمة لـ Discord تراها قبل إرسالها.",
    // Already written in Arabic in the seeded template.
    markdown: "",
  },
];

const byTitle = new Map(ARABIC_TEMPLATES.map((t) => [t.en, t]));

/**
 * The Arabic version of a built-in template, or null when it is not one, or the
 * person renamed it or edited it after it was seeded (then it is theirs as is).
 */
export function arabicTemplate(t: Pick<PageMeta, "title" | "createdAt" | "updatedAt">): ArabicTemplate | null {
  const found = byTitle.get(t.title);
  if (!found) return null;
  const untouched = Math.abs((t.updatedAt ?? 0) - (t.createdAt ?? 0)) < 5_000;
  return untouched ? found : null;
}

/** "{{date}}" as the templates fill it: today's date as YYYY-MM-DD. */
export function fillDate(text: string, now = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return text.replaceAll("{{date}}", iso);
}
