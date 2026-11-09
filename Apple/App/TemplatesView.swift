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
    let onSelectTemplate: (WorkspaceTemplate) -> Void

    private let templates: [WorkspaceTemplate] = [
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
            title: "Canvas Architecture",
            category: "Drawing",
            icon: "pencil.and.outline",
            color: Color(red: 210 / 255, green: 164 / 255, blue: 110 / 255),
            description: "Infinite canvas drawing preset with standard layout grid and system component frames.",
            suggestedKind: "drawing",
            initialMarkdown: "Drawing canvas preset"
        )
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Templates")
                        .font(.system(.largeTitle, design: .default, weight: .bold))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .accessibilityAddTraits(.isHeader)

                    Text("Start quickly with pre-structured layouts for meetings, technical specs, presentations, and drawings.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 16)], spacing: 16) {
                    ForEach(templates) { template in
                        templateCard(template)
                    }
                }
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 880, alignment: .leading)
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
