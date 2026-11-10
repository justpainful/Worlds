#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
import SwiftUI
import WorldsPersistence

/// Single-pane tabs for the currently opened independent personal copy.
struct PersonalTabBar: View {
    let session: PersonalTabSession
    let pages: [StoredPage]
    let select: (String) -> Void
    let close: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(session.pageIDs, id: \.self) { id in
                    if let page = pages.first(where: { $0.id == id }) {
                        let title = page.title.isEmpty ? "Untitled" : page.title
                        HStack(spacing: 4) {
                            Button(title) { select(id) }
                                .lineLimit(2)
                                .accessibilityIdentifier("personal-tab.\(id)")
                                .accessibilityValue(session.activeID == id ? "Selected" : "Not selected")
                            Button("Close tab: \(title)", systemImage: "xmark") { close(id) }
                                .labelStyle(.iconOnly)
                                .accessibilityIdentifier("close-personal-tab.\(id)")
                        }
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(session.activeID == id ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
        }
        .accessibilityLabel("Open personal pages")
        .accessibilityIdentifier("personal-tabs")
    }
}
#endif
