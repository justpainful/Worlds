package worlds.content

/** Built-in definitions copied from the desktop Worlds template catalog, including Mind Maps & Concept Maps. */
data class BuiltinTemplate(val key: String, val title: String, val icon: String, val category: String, val description: String, val markdown: String)

object BuiltinTemplates {
    val all = listOf(
        BuiltinTemplate("todo", "To-do List", "✅", "Personal", "Today, this week, and someday.", "\n## Today\n- [ ]\n## This week\n- [ ]\n## Someday\n- [ ]\n---\n> [!note] Move finished items down as you go. Keep the top of the page about what is next.\n"),
        BuiltinTemplate("project", "Project Tracker", "🧭", "Work", "Goal, milestones, owners and status in one place.", "\n> [!note] **Goal**: one sentence that says what done looks like.\n\n## Milestones\n| Milestone | Owner | Due | Status |\n|---|---|---|---|\n| Scope agreed |  | {{date}} | Not started |\n|  |  |  |  |\n\n## Open questions\n-\n\n## Decisions\n-\n\n## Tasks\n- [ ]\n"),
        BuiltinTemplate("weekly", "Weekly Update {{date}}", "🗓️", "Work", "What shipped, what is next, what is blocked.", "\n## Shipped\n-\n\n## Next\n-\n\n## Blocked\n-\n\n## Notes\n"),
        BuiltinTemplate("feedback", "Feedback Tracker", "💬", "Work", "Collect feedback and decide what to act on.", "\n| From | Feedback | Area | Priority | Action |\n|---|---|---|---|---|\n|  |  |  |  |  |\n\n## Themes\n-\n\n## Acting on\n- [ ]\n"),
        BuiltinTemplate("release", "Release Notes", "🚀", "Product", "Version, highlights, fixes and known issues.", "\n**Version** v1.0.0 · **Date** {{date}}\n\n## Highlights\n-\n\n## Improvements\n-\n\n## Fixes\n-\n\n## Known issues\n-\n"),
        BuiltinTemplate("meeting", "Meeting Notes", "🪑", "Work", "Agenda, decisions and action items.", "\n**Date** {{date}} · **Time**\n\n## Attendees\n-\n\n## Agenda\n1.\n\n## Decisions\n-\n\n## Action items\n- [ ]\n"),
        BuiltinTemplate("roadmap", "Roadmap", "🗺️", "Product", "Now, next, later.", "\n## Now\n| Item | Why | Owner |\n|---|---|---|\n|  |  |  |\n\n## Next\n| Item | Why | Owner |\n|---|---|---|\n|  |  |  |\n\n## Later\n-\n\n> [!note] Re-rank this page every two weeks. Anything that has not moved in a month goes to Later.\n"),
        BuiltinTemplate("bugs", "Bug Tracker", "🐞", "Product", "Reproduce, prioritise, fix.", "\n| Bug | Steps | Severity | Status | Owner |\n|---|---|---|---|---|\n|  |  | High | Open |  |\n\n## Triage rules\n- **High**: data loss, crash, or blocks a core flow.\n- **Medium**: wrong behaviour with a workaround.\n- **Low**: cosmetic.\n"),
        BuiltinTemplate("discord", "Discord Announcement", "📣", "Discord", "Structured message for Discord, previewed before it is sent.", "\n# الاجتماع الإداري\n\n**الوقت** 8:00 PM\n\n---\n\n## المواضيع\n- المتجر\n- السيرفر\n- الطاقم\n\n> [!note] يرجى تأكيد الحضور قبل الموعد.\n"),
        // Mind Maps & Concept Maps (الخرائط الذهنية والمفاهيمية)
        BuiltinTemplate(
            "mindmap_radial",
            "Radial Mind Map — خريطة ذهنية متفرعة",
            "🧠",
            "Mind Maps & Concepts",
            "Central topic with multi-level radial branches, visual diagram, and action takeaways.",
            "\n> [!note] **الفكرة المركزية (Central Idea)**: اكتب الموضوع الرئيسي ثم فرّع المحاور الأساسية.\n\n## المحاور المتفرعة\n| المحور الأساسي | النقاط الفرعية | الكلمات المفتاحية | الأولوية |\n|---|---|---|---|\n| المحور الأول |  |  | عالية |\n| المحور الثاني |  |  | متوسطة |\n| المحور الثالث |  |  | متوسطة |\n\n## خطوات قابلة للتنفيذ\n- [ ]\n"
        ),
        BuiltinTemplate(
            "concept_network",
            "Concept Map — خريطة مفاهيمية (شبكة العلاقات)",
            "🕸️",
            "Mind Maps & Concepts",
            "Concept nodes linked by explicit named propositions (causes, depends on, explains).",
            "\n> [!note] **سؤال التركيز**: ما الظاهرة أو النظام الذي تشرحه هذه الخريطة المفاهيمية؟\n\n## جدول القضايا والعلاقات (Propositions)\n| المفهوم المصدر | علاقة الربط | المفهوم الهدف | مثال أو دليل |\n|---|---|---|---|\n| المفهوم الأساسي | يتكون من | المفهوم الأول |  |\n| المفهوم الأول | يؤدي إلى | النتيجة / الأثر |  |\n"
        ),
        BuiltinTemplate(
            "fishbone_ishikawa",
            "Root Cause Fishbone — تحليل الأسباب الجذرية (إيشيكاوا + 5 لماذا)",
            "🐟",
            "Mind Maps & Concepts",
            "Ishikawa cause-and-effect diagram paired with 5-Whys drilling and corrective actions.",
            "\n> [!warning] **المشكلة المرصودة (Problem Statement)**: صِف المشكلة بدقة.\n\n## تحليل الـ 5 لماذا (5 Whys)\n1. لماذا حدثت المشكلة؟\n2. لماذا؟\n3. السبب الجذري النهائي:\n\n## خطة المعالجة (CAPA)\n| السبب الجذري | الإجراء التصحيحي | المسؤول | الموعد |\n|---|---|---|---|\n|  |  |  | {{date}} |\n"
        ),
        BuiltinTemplate(
            "swot_matrix",
            "SWOT & Strategic Map — مصفوفة SWOT والخريطة الاستراتيجية",
            "♟️",
            "Mind Maps & Concepts",
            "Strengths, Weaknesses, Opportunities, Threats and TOWS strategic cross-matching.",
            "\n## مصفوفة التحليل الرباعي (SWOT)\n| نقاط القوة (Strengths) | نقاط الضعف (Weaknesses) |\n|---|---|\n|  |  |\n| الفرص (Opportunities) | التهديدات (Threats) |\n|  |  |\n\n## استراتيجيات التقاطع (TOWS)\n- استغلال القوة للفرص (S × O):\n- تحصين الضعف أمام التهديدات (W × T):\n"
        ),
        BuiltinTemplate(
            "cornell_feynman",
            "Cornell + Feynman Map — تدوين كورنيل وطريقة فاينمان",
            "🎓",
            "Mind Maps & Concepts",
            "Concept hierarchy, Cornell cue-note matrix, and Feynman plain-language explanation.",
            "\n## جدول كورنيل (Cues & Notes)\n| الأسئلة والكلمات المفتاحية | الشرح والتفاصيل |\n|---|---|\n| ما الفكرة الأساسية؟ |  |\n| كيف يعمل؟ |  |\n\n## اختبار فاينمان (الشرح المبسط)\n- الشرح المبسط:\n- التشبيه / الاستعارة:\n- [ ] مراجعة النقاط الغامضة\n"
        ),
        BuiltinTemplate(
            "decision_tree",
            "Decision Tree & Scenarios — شجرة القرارات والسيناريوهات",
            "🌿",
            "Mind Maps & Concepts",
            "Map choices, probabilities, payoffs, risks, and fallback plans.",
            "\n## مقارنة الخيارات (Options Matrix)\n| الخيار | المزايا | المخاطر | التكلفة | التقييم (1-10) |\n|---|---|---|---|---|\n| الخيار أ |  |  |  |  |\n| الخيار ب |  |  |  |  |\n\n## القرار النهائي وخطة الطوارئ\n-\n"
        ),
        BuiltinTemplate(
            "argument_map",
            "Argument & Evidence Map — خريطة الحجج والأدلة والاعتراضات",
            "⚖️",
            "Mind Maps & Concepts",
            "Structure thesis claims, supporting premises, empirical evidence, objections, and rebuttals.",
            "\n> [!note] **الأطروحة المركزية (Central Thesis)**:\n\n| النوع | النص | مصدر الدليل | القوة |\n|---|---|---|---|\n| حجة مؤيدة |  |  | قوية |\n| اعتراض |  |  | متوسطة |\n| تفنيد الاعتراض |  |  | قوية |\n"
        ),
        BuiltinTemplate(
            "systems_causal_loop",
            "Systems Thinking Loop — التفكير المنظومي وحلقات التغذية الراجعة",
            "🔄",
            "Mind Maps & Concepts",
            "Reinforcing and balancing feedback loops, bottlenecks, and high-leverage interventions.",
            "\n## متغيرات النظام ونقاط الارتكاز\n| المتغير | النوع | كيف يؤثر على النظام؟ | نقطة التدخل |\n|---|---|---|---|\n|  |  |  |  |\n"
        ),
        BuiltinTemplate(
            "compare_contrast",
            "Compare & Contrast Map — خريطة المقارنة والاختلاف والتقاطع",
            "🔀",
            "Mind Maps & Concepts",
            "Side-by-side conceptual comparison across criteria, shared core, and unique traits.",
            "\n## مصفوفة المعايير\n| معيار المقارنة | المفهوم الأول | المفهوم الثاني | الفارق الجوهري |\n|---|---|---|---|\n| الهدف الأساسي |  |  |  |\n| نقاط القوة |  |  |  |\n| القيود |  |  |  |\n"
        ),
        BuiltinTemplate(
            "knowledge_mastery_tree",
            "Knowledge Tree & Spaced Review — شجرة إتقان المعرفة والمراجعة المتباعدة",
            "🌳",
            "Mind Maps & Concepts",
            "Prerequisite skill tree with mastery status and spaced repetition checkpoints.",
            "\n## سجل الإتقان والمراجعة المتباعدة\n| المفهوم / المهارة | المتطلب السابق | الاستيعاب (1-5) | مراجعة +1 يوم | مراجعة +3 أيام | مراجعة +7 أيام |\n|---|---|---|---|---|---|\n| الأساسيات 1 | — | 4/5 | [x] | [ ] | [ ] |\n"
        ),
    )
}
