//! Built-in templates. Authored in the constrained Markdown dialect and
//! parsed into real structured blocks when seeded; after seeding they are
//! ordinary editable template pages.

pub struct Template {
    pub key: &'static str,
    pub title: &'static str,
    pub icon: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub markdown: &'static str,
}

pub const BUILTIN: &[Template] = &[
    Template {
        key: "todo",
        title: "To-do List",
        icon: "✅",
        category: "Personal",
        description: "Today, this week, and someday.",
        markdown: r#"
## Today
- [ ]
## This week
- [ ]
## Someday
- [ ]
---
> [!note] Move finished items down as you go. Keep the top of the page about what is next.
"#,
    },
    Template {
        key: "project",
        title: "Project Tracker",
        icon: "🧭",
        category: "Work",
        description: "Goal, milestones, owners and status in one place.",
        markdown: r#"
> [!note] **Goal**: one sentence that says what done looks like.

## Milestones
| Milestone | Owner | Due | Status |
|---|---|---|---|
| Scope agreed |  | {{date}} | Not started |
|  |  |  |  |

## Open questions
-

## Decisions
-

## Tasks
- [ ]
"#,
    },
    Template {
        key: "weekly",
        title: "Weekly Update {{date}}",
        icon: "🗓️",
        category: "Work",
        description: "What shipped, what is next, what is blocked.",
        markdown: r#"
## Shipped
-

## Next
-

## Blocked
-

## Notes
"#,
    },
    Template {
        key: "feedback",
        title: "Feedback Tracker",
        icon: "💬",
        category: "Work",
        description: "Collect feedback and decide what to act on.",
        markdown: r#"
| From | Feedback | Area | Priority | Action |
|---|---|---|---|---|
|  |  |  |  |  |

## Themes
-

## Acting on
- [ ]
"#,
    },
    Template {
        key: "release",
        title: "Release Notes",
        icon: "🚀",
        category: "Product",
        description: "Version, highlights, fixes and known issues.",
        markdown: r#"
**Version** v1.0.0 · **Date** {{date}}

## Highlights
-

## Improvements
-

## Fixes
-

## Known issues
-
"#,
    },
    Template {
        key: "meeting",
        title: "Meeting Notes",
        icon: "🪑",
        category: "Work",
        description: "Agenda, decisions and action items.",
        markdown: r#"
**Date** {{date}} · **Time**

## Attendees
-

## Agenda
1.

## Decisions
-

## Action items
- [ ]
"#,
    },
    Template {
        key: "roadmap",
        title: "Roadmap",
        icon: "🗺️",
        category: "Product",
        description: "Now, next, later.",
        markdown: r#"
## Now
| Item | Why | Owner |
|---|---|---|
|  |  |  |

## Next
| Item | Why | Owner |
|---|---|---|
|  |  |  |

## Later
-

> [!note] Re-rank this page every two weeks. Anything that has not moved in a month goes to Later.
"#,
    },
    Template {
        key: "bugs",
        title: "Bug Tracker",
        icon: "🐞",
        category: "Product",
        description: "Reproduce, prioritise, fix.",
        markdown: r#"
| Bug | Steps | Severity | Status | Owner |
|---|---|---|---|---|
|  |  | High | Open |  |

## Triage rules
- **High**: data loss, crash, or blocks a core flow.
- **Medium**: wrong behaviour with a workaround.
- **Low**: cosmetic.
"#,
    },
    Template {
        key: "discord",
        title: "Discord Announcement",
        icon: "📣",
        category: "Discord",
        description: "Structured message for Discord, previewed before it is sent.",
        markdown: r#"
# الاجتماع الإداري

**الوقت** 8:00 PM

---

## المواضيع
- المتجر
- السيرفر
- الطاقم

> [!note] يرجى تأكيد الحضور قبل الموعد.
"#,
    },
    // -----------------------------------------------------------------------
    // Mind Maps & Concept Maps (الخرائط الذهنية والمفاهيمية)
    // -----------------------------------------------------------------------
    Template {
        key: "mindmap_radial",
        title: "Radial Mind Map — خريطة ذهنية متفرعة",
        icon: "🧠",
        category: "Mind Maps & Concepts",
        description: "Central topic with multi-level radial branches, visual diagram, and action takeaways.",
        markdown: r#"
> [!note] **الفكرة المركزية (Central Idea)**: اكتب الموضوع الرئيسي في وسط الخريطة ثم فرّع المحاور الأساسية والفرعية.

```mermaid
mindmap
  root((الموضوع الرئيسي))
    المحور الأول
      فكرة فرعية 1.1
      فكرة فرعية 1.2
    المحور الثاني
      فكرة فرعية 2.1
      فكرة فرعية 2.2
    المحور الثالث
      تطبيق عملي
      أمثلة وشواهد
    المحور الرابع
      أسئلة مفتوحة
      الخطوات القادمة
```

## تفصيل المحاور (Branches Breakdown)
| المحور الأساسي | النقاط الفرعية | الكلمات المفتاحية | الأولوية |
|---|---|---|---|
| المحور الأول |  |  | عالية |
| المحور الثاني |  |  | متوسطة |
| المحور الثالث |  |  | متوسطة |
| المحور الرابع |  |  | عادية |

## الروابط غير المباشرة (Cross-Links)
-

## خطوات قابلة للتنفيذ (Actionable Takeaways)
- [ ]
"#,
    },
    Template {
        key: "concept_network",
        title: "Concept Map — خريطة مفاهيمية (شبكة العلاقات)",
        icon: "🕸️",
        category: "Mind Maps & Concepts",
        description: "Concept nodes linked by explicit named propositions (causes, depends on, explains).",
        markdown: r#"
> [!note] **سؤال التركيز (Focus Question)**: ما الظاهرة أو النظام الذي تشرحه هذه الخريطة المفاهيمية؟

```mermaid
flowchart TD
  C0(["المفهوم الأساسي"])
  C1["المفهوم الأول"]
  C2["المفهوم الثاني"]
  C3["المفهوم الثالث"]
  C4["النتيجة / الأثر"]
  C0 -->|يتكون من| C1
  C0 -->|يعتمد على| C2
  C1 -->|يؤدي إلى| C3
  C2 -->|يتفاعل مع| C3
  C3 -->|ينتج عنه| C4
```

## جدول القضايا والعلاقات (Propositions Table)
| المفهوم المصدر (Source) | علاقة الربط (Linking Phrase) | المفهوم الهدف (Target) | مثال أو دليل |
|---|---|---|---|
| المفهوم الأساسي | يتكون من | المفهوم الأول |  |
| المفهوم الأول | يؤدي إلى | المفهوم الثالث |  |
| المفهوم الثالث | ينتج عنه | النتيجة / الأثر |  |

## تعريفات المفاهيم الحرجة (Key Definitions)
- **المفهوم الأساسي**:
- **المفهوم الأول**:
- **المفهوم الثاني**:
"#,
    },
    Template {
        key: "fishbone_ishikawa",
        title: "Root Cause Fishbone — تحليل الأسباب الجذرية (إيشيكاوا + 5 لماذا)",
        icon: "🐟",
        category: "Mind Maps & Concepts",
        description: "Ishikawa cause-and-effect diagram paired with 5-Whys drilling and corrective actions.",
        markdown: r#"
> [!warning] **المشكلة / الأثر المرصود (Problem Statement)**: صِف المشكلة بدقة وبأرقام واضحة.

```mermaid
flowchart LR
  subgraph People["الأفراد (People)"]
    P1["نقص تدريب"] --> Effect
    P2["ضغط العمل"] --> Effect
  end
  subgraph Process["العمليات (Process)"]
    PR1["خطوات غير موثقة"] --> Effect
    PR2["تأخر الاعتماد"] --> Effect
  end
  subgraph Tech["التقنية والأدوات (Tools)"]
    T1["أعطال النظام"] --> Effect
    T2["ضعف التكامل"] --> Effect
  end
  subgraph Env["البيئة والبيانات (Environment)"]
    E1["بيانات غير مكتملة"] --> Effect
  end
  Effect(["🎯 المشكلة الأساسية"])
```

## تحليل الـ 5 لماذا (5 Whys Drill-down)
1. **لماذا حدثت المشكلة؟** —
2. **لماذا حدث ذلك؟** —
3. **لماذا؟** —
4. **لماذا؟** —
5. **السبب الجذري النهائي (Root Cause)** —

## خطة المعالجة والوقاية (CAPA)
| السبب الجذري | الإجراء التصحيحي | المسؤول | الموعد | الحالة |
|---|---|---|---|---|
|  |  |  | {{date}} | قيد التنفيذ |
"#,
    },
    Template {
        key: "swot_matrix",
        title: "SWOT & Strategic Map — مصفوفة SWOT والخريطة الاستراتيجية",
        icon: "♟️",
        category: "Mind Maps & Concepts",
        description: "Strengths, Weaknesses, Opportunities, Threats and TOWS strategic cross-matching.",
        markdown: r#"
**المبادرة / المشروع** · **التاريخ** {{date}}

```mermaid
flowchart TB
  Center(["الهدف الاستراتيجي"])
  subgraph Internal["عوامل داخلية (Internal)"]
    S["💪 نقاط القوة (Strengths)"]
    W["🩹 نقاط الضعف (Weaknesses)"]
  end
  subgraph External["عوامل خارجية (External)"]
    O["🌱 الفرص (Opportunities)"]
    T["⚡ التهديدات (Threats)"]
  end
  S --> Center
  W -.-> Center
  O --> Center
  T -.-> Center
```

## مصفوفة التحليل الرباعي (SWOT Grid)
| 💪 نقاط القوة (Strengths) | 🩹 نقاط الضعف (Weaknesses) |
|---|---|
| • | • |
| **🌱 الفرص (Opportunities)** | **⚡ التهديدات (Threats)** |
| • | • |

## استراتيجيات التقاطع (TOWS Actions)
- **استغلال القوة لاقتناص الفرص (S × O)**:
- **توظيف القوة لصد التهديدات (S × T)**:
- **معالجة الضعف عبر الفرص المتاحة (W × O)**:
- **تحصين نقاط الضعف أمام التهديدات (W × T)**:
"#,
    },
    Template {
        key: "cornell_feynman",
        title: "Cornell + Feynman Map — تدوين كورنيل وطريقة فاينمان",
        icon: "🎓",
        category: "Mind Maps & Concepts",
        description: "Concept hierarchy, Cornell cue-note matrix, and Feynman plain-language explanation.",
        markdown: r#"
> [!note] **الموضوع / الفصل**: · **التاريخ**: {{date}}

```mermaid
flowchart LR
  Topic(["الفكرة المحورية"]) --> K1["المفهوم 1"]
  Topic --> K2["المفهوم 2"]
  Topic --> K3["المفهوم 3"]
  K1 --> App1["مثال تطبيقي"]
  K2 --> App2["حالة خاصة"]
  K3 --> App3["ربط بمفهوم سابق"]
```

## جدول كورنيل (Cues & Notes)
| الأسئلة والكلمات المفتاحية (Cues) | الشرح والتفاصيل والرسوم (Detailed Notes) |
|---|---|
| ما الفكرة الأساسية؟ |  |
| كيف يعمل؟ |  |
| متى يطبّق ومتى يفشل؟ |  |

## اختبار فاينمان (Feynman Simplification)
> [!tip] اشرح هذا المفهوم بلغة بسيطة جدًا كأنك تشرحه لشخص غير متخصص:

- **الشرح المبسط**:
- **التشبيه / الاستعارة (Analogy)**:
- **الفجوات التي تحتاج مراجعة**:
  - [ ]
"#,
    },
    Template {
        key: "decision_tree",
        title: "Decision Tree & Scenarios — شجرة القرارات والسيناريوهات",
        icon: "🌿",
        category: "Mind Maps & Concepts",
        description: "Map choices, probabilities, payoffs, risks, and fallback plans.",
        markdown: r#"
> [!note] **القرار المطلوب اتخاذه**: · **الموعد النهائي**: {{date}}

```mermaid
flowchart LR
  D{"القرار الرئيسي"}
  D -->|الخيار أ| A1["احتمال نجاح عالٍ"]
  D -->|الخيار ب| B1["تكلفة أقل / مخاطرة أعلى"]
  D -->|الخيار ج| C1["تأجيل / إبقاء الوضع"]
  A1 --> A2["العائد المتوقع"]
  B1 --> B2["خطة الطوارئ"]
```

## مقارنة الخيارات (Options Matrix)
| الخيار | المزايا | المخاطر | التكلفة / الجهد | الأثر المتوقع | التقييم (1-10) |
|---|---|---|---|---|---|
| الخيار أ |  |  |  |  |  |
| الخيار ب |  |  |  |  |  |
| الخيار ج |  |  |  |  |  |

## القرار النهائي وخطة التراجع (Reversibility & Fallback)
- **الخيار المعتمد**:
- **مؤشر الإنذار المبكر (Kill Criteria)**:
"#,
    },
    Template {
        key: "argument_map",
        title: "Argument & Evidence Map — خريطة الحجج والأدلة والاعتراضات",
        icon: "⚖️",
        category: "Mind Maps & Concepts",
        description: "Structure thesis claims, supporting premises, empirical evidence, objections, and rebuttals.",
        markdown: r#"
> [!note] **الأطروحة / الادعاء المركزي (Central Thesis)**: اكتب الفرضية أو الرأي المراد فحصه.

```mermaid
flowchart BT
  E1["📊 دليل 1 / إحصائية"] --> P1["🟢 حجة مؤيدة 1"]
  E2["📑 دراسة / تجربة"] --> P2["🟢 حجة مؤيدة 2"]
  R1["🛡️ الرد والتفنيد"] --> O1["🔴 اعتراض / حجة مضادة"]
  P1 --> Claim(["⚖️ الأطروحة المركزية"])
  P2 --> Claim
  O1 -.->|يطعن في| Claim
```

## تفصيل الحجج والأدلة
| النوع | النص | مصدر الدليل / المرجع | قوة الحجة |
|---|---|---|---|
| 🟢 حجة مؤيدة |  |  | قوية |
| 🔴 اعتراض |  |  | متوسطة |
| 🛡️ تفنيد الاعتراض |  |  | قوية |

## الخلاصة والحكم المتوازن
-
"#,
    },
    Template {
        key: "systems_causal_loop",
        title: "Systems Thinking Loop — التفكير المنظومي وحلقات التغذية الراجعة",
        icon: "🔄",
        category: "Mind Maps & Concepts",
        description: "Reinforcing and balancing feedback loops, bottlenecks, and high-leverage interventions.",
        markdown: r#"
> [!note] **النظام المدروس (System Boundary)**: ما المتغيرات المتفاعلة داخل هذا النظام؟

```mermaid
flowchart LR
  V1(["المتغير أ"]) -->|"+ يزيد"| V2(["المتغير ب"])
  V2 -->|"+ يزيد"| V3(["المتغير ج"])
  V3 -->|"+ حلقة تعزيز (R)"| V1
  V3 -->|"- يضبط / حلقة توازن (B)"| V4(["عامل التوازن"])
  V4 -->|"- يقلل"| V1
```

## متغيرات النظام ونقاط الارتكاز (Leverage Points)
| المتغير | النوع (مخزون / تدفق) | كيف يؤثر على النظام؟ | نقطة التدخل المقترحة |
|---|---|---|---|
|  |  |  |  |

## الاختناقات والتأخيرات الزمنية (Delays & Bottlenecks)
-
"#,
    },
    Template {
        key: "compare_contrast",
        title: "Compare & Contrast Map — خريطة المقارنة والاختلاف والتقاطع",
        icon: "🔀",
        category: "Mind Maps & Concepts",
        description: "Side-by-side conceptual comparison across criteria, shared core, and unique traits.",
        markdown: r#"
```mermaid
flowchart TB
  subgraph Left["المفهوم / البديل الأول"]
    L1["سمة منفردة أ1"]
    L2["سمة منفردة أ2"]
  end
  subgraph Shared["منطقة التقاطع والتشابه"]
    S1["القاسم المشترك 1"]
    S2["القاسم المشترك 2"]
  end
  subgraph Right["المفهوم / البديل الثاني"]
    R1["سمة منفردة ب1"]
    R2["سمة منفردة ب2"]
  end
  L1 --- S1 --- R1
  L2 --- S2 --- R2
```

## مصفوفة المعايير (Comparison Criteria)
| معيار المقارنة | المفهوم الأول | المفهوم الثاني | الفارق الجوهري |
|---|---|---|---|
| الهدف الأساسي |  |  |  |
| آلية العمل |  |  |  |
| نقاط القوة |  |  |  |
| القيود والعيوب |  |  |  |
| متى نختاره؟ |  |  |  |
"#,
    },
    Template {
        key: "knowledge_mastery_tree",
        title: "Knowledge Tree & Spaced Review — شجرة إتقان المعرفة والمراجعة المتباعدة",
        icon: "🌳",
        category: "Mind Maps & Concepts",
        description: "Prerequisite skill tree with mastery status and spaced repetition checkpoints.",
        markdown: r#"
```mermaid
flowchart BT
  F1["الأساسيات 1"] --> M1["المستوى المتوسط 1"]
  F2["الأساسيات 2"] --> M1
  F2 --> M2["المستوى المتوسط 2"]
  M1 --> Adv["المستوى المتقدم / الإتقان"]
  M2 --> Adv
```

## سجل الإتقان والمراجعة المتباعدة (Spaced Repetition Log)
| المفهوم / المهارة | المتطلب السابق | درجة الاستيعاب (1-5) | مراجعة 1 (+1 يوم) | مراجعة 2 (+3 أيام) | مراجعة 3 (+7 أيام) | مراجعة 4 (+21 يوم) |
|---|---|---|---|---|---|---|
| الأساسيات 1 | — | ⭐⭐⭐⭐ | ✅ | ⬜ | ⬜ | ⬜ |
| الأساسيات 2 | — | ⭐⭐⭐ | ⬜ | ⬜ | ⬜ | ⬜ |
| المستوى المتوسط 1 | الأساسيات 1، 2 | ⭐⭐ | ⬜ | ⬜ | ⬜ | ⬜ |
"#,
    },
];
