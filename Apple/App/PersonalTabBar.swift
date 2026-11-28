#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
import SwiftUI
import WorldsPersistence

/// Single-pane tabs for the currently opened independent personal copy.
/// The strip is one glass capsule, like the Windows tab capsule; the active tab
/// gets the soft lens with no edge.
struct PersonalTabBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let session: PersonalTabSession
    let pages: [StoredPage]
    let select: (String) -> Void
    let close: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            WorldsGlassChromeGroup(spacing: 8) {
                HStack(spacing: 2) {
                    ForEach(session.pageIDs, id: \.self) { id in
                        if let page = pages.first(where: { $0.id == id }) {
                            let title = page.title.isEmpty ? "Untitled" : page.title
                            let active = session.activeID == id
                            HStack(spacing: 4) {
                                Button(title) { select(id) }
                                    .buttonStyle(.plain)
                                    .font(.subheadline.weight(active ? .semibold : .regular))
                                    .foregroundStyle(active ? Color.primary : Color.secondary)
                                    .lineLimit(2)
                                    .accessibilityIdentifier("personal-tab.\(id)")
                                    .accessibilityValue(active ? "Selected" : "Not selected")
                                Button("Close tab: \(title)", systemImage: "xmark") { close(id) }
                                    .labelStyle(.iconOnly)
                                    .buttonStyle(.plain)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .accessibilityIdentifier("close-personal-tab.\(id)")
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background {
                                if active {
                                    Capsule().fill(WorldsPalette.lens(for: colorScheme))
                                }
                            }
                            .animation(WorldsMotion.tab, value: active)
                        }
                    }
                }
                .padding(3)
                .worldsGlassCapsule(interactive: false)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("Open personal pages")
        .accessibilityIdentifier("personal-tabs")
    }
}
#endif
