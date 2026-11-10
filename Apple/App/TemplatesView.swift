import SwiftUI
import WorldsPersistence

struct WorkspaceTemplate: Identifiable, Sendable {
    let id: String
    let title: String
    let category: String
    let icon: String
    let color: Color
    let description: String
    let suggestedKind: String
    let initialMarkdown: String
}

struct TemplatesView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedCategory: String = "All"
    let onSelectTemplate: (WorkspaceTemplate) -> Void

    private let templates: [WorkspaceTemplate] = [
        // Mind Maps & Concept Maps
        WorkspaceTemplate(
            id: "mindmap-radial",
            title: "Radial Mind Map — خريطة ذهنية متفرعة",
            category: "Mind Maps & Concepts",
            icon: "brain.head.profile",
            color: .purple,
            description: "Central topic with multi-level radial branches, visual Mermaid mindmap, and action takeaways.",
            suggestedKind: "page",
            initialMarkdown: "# Radial Mind Map — خريطة ذهنية متفرعة\n\n> [!note] **الفكرة المركزية (Central Idea)**: اكتب الموضوع الرئيسي ثم فرّع المحاور الأساسية.\n\n```mermaid\nmindmap\n  root((الموضوع الرئيسي))\n    المحور الأول\n      فكرة فرعية 1.1\n      فكرة فرعية 1.2\n    المحور الثاني\n      فكرة فرعية 2.1\n      فكرة فرعية 2.2\n    المحور الثالث\n      تطبيق عملي\n      أمثلة وشواهد\n```\n\n## خطوات قابلة للتنفيذ\n- [ ] "
        ),
        WorkspaceTemplate(
            id: "concept-network",
            title: "Concept Map — خريطة مفاهيمية (شبكة العلاقات)",
            category: "Mind Maps & Concepts",
            icon: "point.3.connected.trianglepath.dotted",
            color: .indigo,
            description: "Concept nodes linked by explicit named propositions (causes, depends on, explains).",
            suggestedKind: "page",
            initialMarkdown: "# Concept Map — خريطة مفاهيمية\n\n```mermaid\nflowchart TD\n  C0([\"المفهوم الأساسي\"]) -->|يتكون من| C1[\"المفهوم الأول\"]\n  C0 -->|يعتمد على| C2[\"المفهوم الثاني\"]\n  C1 -->|يؤدي إلى| C3[\"النتيجة / الأثر\"]\n  C2 -->|يتفاعل مع| C3\n```\n\n## جدول العلاقات (Propositions)\n| المفهوم المصدر | علاقة الربط | المفهوم الهدف |\n|---|---|---|\n| المفهوم الأساسي | يتكون من | المفهوم الأول |"
        ),
        WorkspaceTemplate(
            id: "fishbone-ishikawa",
            title: "Root Cause Fishbone — تحليل الأسباب الجذرية",
            category: "Mind Maps & Concepts",
            icon: "arrow.triangle.branch",
            color: .red,
            description: "Ishikawa cause-and-effect diagram paired with 5-Whys drilling and corrective actions.",
            suggestedKind: "page",
            initialMarkdown: "# Root Cause Fishbone (Ishikawa + 5 Whys)\n\n```mermaid\nflowchart LR\n  P[\"الأفراد (People)\"] --> Effect([\"🎯 المشكلة الأساسية\"])\n  PR[\"العمليات (Process)\"] --> Effect\n  T[\"التقنية (Tools)\"] --> Effect\n  E[\"البيئة (Environment)\"] --> Effect\n```\n\n## تحليل الـ 5 لماذا (5 Whys)\n1. لماذا حدثت المشكلة؟\n2. لماذا؟\n3. السبب الجذري النهائي:"
        ),
        WorkspaceTemplate(
            id: "swot-matrix",
            title: "SWOT & Strategic Map — مصفوفة SWOT الاستراتيجية",
            category: "Mind Maps & Concepts",
            icon: "square.grid.2x2.fill",
            color: .green,
            description: "Strengths, Weaknesses, Opportunities, Threats and TOWS strategic cross-matching.",
            suggestedKind: "page",
            initialMarkdown: "# مصفوفة SWOT والخريطة الاستراتيجية\n\n| 💪 نقاط القوة (Strengths) | 🩹 نقاط الضعف (Weaknesses) |\n|---|---|\n| • | • |\n| **🌱 الفرص (Opportunities)** | **⚡ التهديدات (Threats)** |\n| • | • |\n\n## استراتيجيات التقاطع (TOWS)\n- **S × O**:\n- **W × T**:"
        ),
        WorkspaceTemplate(
            id: "cornell-feynman",
            title: "Cornell + Feynman Map — تدوين كورنيل وفاينمان",
            category: "Mind Maps & Concepts",
            icon: "graduationcap.fill",
            color: .cyan,
            description: "Concept hierarchy, Cornell cue-note matrix, and Feynman plain-language explanation.",
            suggestedKind: "page",
            initialMarkdown: "# تدوين كورنيل وطريقة فاينمان\n\n| الأسئلة والكلمات المفتاحية (Cues) | الشرح والتفاصيل (Notes) |\n|---|---|\n| ما الفكرة الأساسية؟ | |\n| كيف يعمل؟ | |\n\n## اختبار فاينمان (الشرح المبسط)\n- **التشبيه / الاستعارة**:\n- [ ] مراجعة النقاط الغامضة"
        ),
        WorkspaceTemplate(
            id: "decision-tree",
            title: "Decision Tree & Scenarios — شجرة القرار والسيناريوهات",
            category: "Mind Maps & Concepts",
            icon: "arrow.triangle.pull",
            color: .mint,
            description: "Map choices, probabilities, payoffs, risks, and fallback plans.",
            suggestedKind: "page",
            initialMarkdown: "# شجرة القرارات والسيناريوهات\n\n```mermaid\nflowchart LR\n  D{\"القرار الرئيسي\"} -->|الخيار أ| A1[\"عائد مرتفع\"]\n  D -->|الخيار ب| B1[\"مخاطرة أقل\"]\n```\n\n| الخيار | المزايا | المخاطر | التقييم |\n|---|---|---|---|\n| الخيار أ | | | |"
        ),
        WorkspaceTemplate(
            id: "argument-map",
            title: "Argument & Logic Map — خريطة الحجج والمنطق",
            category: "Mind Maps & Concepts",
            icon: "scale.3d",
            color: .teal,
            description: "Structure claims, supporting premises, counterarguments, rebuttals, and evidence.",
            suggestedKind: "page",
            initialMarkdown: "# خريطة الحجج والمنطق\n\n- **الادعاء الرئيسي (Claim)**:\n- **الحجج الداعمة (Premises)**:\n- **الاعتراضات والردود (Rebuttals)**:"
        ),
        WorkspaceTemplate(
            id: "systems-causal-loop",
            title: "Systems Thinking & Causal Loop — التفكير النظمي",
            category: "Mind Maps & Concepts",
            icon: "arrow.triangle.2.circlepath",
            color: .orange,
            description: "Model reinforcing feedback loops, balancing loops, bottlenecks, and leverage points.",
            suggestedKind: "page",
            initialMarkdown: "# التفكير النظمي وحلقات التغذية الراجعة\n\n- **حلقة التعزيز (Reinforcing Loop R1)**:\n- **حلقة التوازن (Balancing Loop B1)**:"
        ),
        WorkspaceTemplate(
            id: "compare-contrast",
            title: "Compare & Contrast Matrix — مصفوفة المقارنة والمفاضلة",
            category: "Mind Maps & Concepts",
            icon: "rectangle.split.2x2",
            color: .pink,
            description: "Evaluate concepts, architectures, or vendors across weighted criteria.",
            suggestedKind: "page",
            initialMarkdown: "# مصفوفة المقارنة والمفاضلة\n\n| المعيار | الوزن | الخيار 1 | الخيار 2 |\n|---|---|---|---|\n| الأداء والتكلفة | 40% | | |"
        ),
        WorkspaceTemplate(
            id: "knowledge-mastery-tree",
            title: "Knowledge Mastery Tree — شجرة إتقان المعرفة والمهارات",
            category: "Mind Maps & Concepts",
            icon: "list.bullet.indent",
            color: .yellow,
            description: "Map prerequisites, core competencies, advanced topics, and mastery milestones.",
            suggestedKind: "page",
            initialMarkdown: "# شجرة إتقان المعرفة والمهارات\n\n- [ ] المستوى التأسيسي (Foundations)\n- [ ] المستوى المتوسط (Core Mastery)\n- [ ] المستوى المتقدم (Advanced Synthesis)"
        ),
        WorkspaceTemplate(
            id: "excel-spreadsheet-budget",
            title: "Excel Budget & KPI Workbook — جدول مالي ومؤشرات",
            category: "Spreadsheet",
            icon: "tablecells.fill",
            color: .green,
            description: "Full Excel-compatible multi-sheet spreadsheet with SUM, IF, VLOOKUP, and financial formulas.",
            suggestedKind: "spreadsheet",
            initialMarkdown: "Spreadsheet workbook"
        ),
        WorkspaceTemplate(
            id: "meeting-notes",
            title: "Meeting Notes",
            category: "Productivity",
            icon: "person.3.fill",
            color: .blue,
            description: "Capture meeting date, attendees, key decisions, and action items with owners.",
            suggestedKind: "page",
            initialMarkdown: "# Meeting Notes\n\n**Date**: \n**Attendees**: \n\n## Agenda\n- Discussion topics\n\n## Decisions\n- Key decision 1\n\n## Action Items\n- [ ] Follow up on deliverables"
        ),
        WorkspaceTemplate(
            id: "project-spec",
            title: "Technical Specification",
            category: "Engineering",
            icon: "doc.text.magnifyingglass",
            color: .indigo,
            description: "Detailed system architecture, API contracts, database schema, and security invariants.",
            suggestedKind: "document",
            initialMarkdown: "# Technical Specification\n\n## 1. Overview\nHigh-level goal and architecture.\n\n## 2. API Contracts\n- Protocol specification\n- Data models\n\n## 3. Security & Invariants\n- Sandbox constraints\n- Authorization gate"
        ),
        WorkspaceTemplate(
            id: "pitch-deck",
            title: "Presentation Pitch",
            category: "Design",
            icon: "rectangle.inset.filled.and.person.filled",
            color: .orange,
            description: "Structured slide outline covering problem statement, solution, market, and roadmap.",
            suggestedKind: "presentation",
            initialMarkdown: "# Pitch Deck Outline\n\nSlide 1: Problem statement\nSlide 2: Solution & architecture\nSlide 3: Market & differentiation\nSlide 4: Roadmap & timeline"
        ),
        WorkspaceTemplate(
            id: "weekly-review",
            title: "Weekly Review",
            category: "Personal",
            icon: "calendar.badge.clock",
            color: .teal,
            description: "Weekly reflection covering major accomplishments, blockers, and next week's focus.",
            suggestedKind: "page",
            initialMarkdown: "# Weekly Review\n\n## Wins & Completed Work\n- Shipped feature X\n\n## Challenges & Blockers\n- Review unresolved issues\n\n## Top Priorities Next Week\n1. Priority item 1\n2. Priority item 2"
        ),
        WorkspaceTemplate(
            id: "architecture-diagram",
            title: "Visual Mind Map & Architecture Canvas",
            category: "Drawing",
            icon: "pencil.and.outline",
            color: Color(red: 210 / 255, green: 164 / 255, blue: 110 / 255),
            description: "Infinite canvas drawing preset for visual mind maps, concept networks, and system diagrams.",
            suggestedKind: "drawing",
            initialMarkdown: "Drawing canvas preset"
        )
    ]

    private var categories: [String] {
        ["All", "Mind Maps & Concepts", "Spreadsheet", "Drawing", "Productivity", "Engineering", "Design", "Personal"]
    }

    private var filteredTemplates: [WorkspaceTemplate] {
        if selectedCategory == "All" { return templates }
        return templates.filter { $0.category == selectedCategory }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Workspace Templates")
                        .font(.system(.largeTitle, design: .default, weight: .bold))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .accessibilityAddTraits(.isHeader)

                    Text("Start quickly with Visual Mind Maps, Concept Networks, Excel Spreadsheets, Technical Specs, and Study Canvases.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)

                VisualMindMapCanvasPreview { preset in
                    if let match = templates.first(where: { $0.id.contains(preset) }) ?? templates.first {
                        onSelectTemplate(match)
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(categories, id: \.self) { category in
                            Button {
                                selectedCategory = category
                            } label: {
                                Text(category)
                                    .font(.caption.weight(.semibold))
                                    .fixedSize(horizontal: true, vertical: false)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(
                                        selectedCategory == category
                                            ? WorldsPalette.accent(for: colorScheme).opacity(0.22)
                                            : Color.secondary.opacity(0.1),
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        selectedCategory == category
                                            ? WorldsPalette.accent(for: colorScheme)
                                            : .primary
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 16)], spacing: 16) {
                    ForEach(filteredTemplates) { template in
                        templateCard(template)
                    }
                }
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .padding(.bottom, 56)
            .frame(maxWidth: 1020, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .navigationTitle("Templates")
        .accessibilityIdentifier("templates-view")
    }

    private func templateCard(_ template: WorkspaceTemplate) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Image(systemName: template.icon)
                    .font(.title3)
                    .foregroundStyle(template.color)
                    .frame(width: 36, height: 36)
                    .background(template.color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))

                Spacer()

                Text(template.category)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(template.color.opacity(0.15), in: Capsule())
                    .foregroundStyle(template.color)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(template.title)
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))

                Text(template.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Spacer(minLength: 8)

            Button {
                onSelectTemplate(template)
            } label: {
                HStack {
                    Text("Use Template")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Image(systemName: "arrow.forward")
                        .font(.caption)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(WorldsPalette.accent(for: colorScheme).opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Use \(template.title) template")
        }
        .padding(16)
        .frame(minHeight: 180)
        .worldsGlass(cornerRadius: 14)
    }
}
