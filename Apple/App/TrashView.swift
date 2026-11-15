import SwiftUI
import WorldsPersistence

struct TrashView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let pages: [StoredPage]
    let onRestore: (String) -> Void
    let onDeletePermanently: (String) -> Void
    let onEmptyTrash: () -> Void
    /// The desktop's Trash for the person's own workspace. When nil, the
    /// earlier archive based list of a local copy is shown.
    var storeTrash: [StoredTrashedPage]? = nil
    /// Permanent deletion needs a checked store operation that does not exist
    /// yet, so it is offered only for an independent local copy.
    var permanentDeletionAvailable: Bool = true

    @State private var confirmEmptyTrash = false
    @State private var itemToDeletePermanently: StoredPage?

    private var trashedPages: [StoredPage] {
        if let storeTrash { return storeTrash.map(\.page) }
        return pages.filter { $0.archived }
    }

    var body: some View {
        Group {
            if trashedPages.isEmpty {
                ContentUnavailableView(
                    "Trash is empty",
                    systemImage: "trash",
                    description: Text("Items you delete will be kept here until you delete them permanently or empty the trash.")
                )
                .background(WorldsPalette.paper(for: colorScheme))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Trash")
                                    .font(.system(.largeTitle, design: .default, weight: .bold))
                                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                    .accessibilityAddTraits(.isHeader)

                                if storeTrash == nil {
                                    // Whole sentences, so each language can say the count its own way.
                                    (trashedPages.count == 1 ? Text("1 archived item") : Text("\(trashedPages.count) archived items"))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Text("Restore brings a page back with its subpages. Worlds on your computer can delete pages permanently.")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if permanentDeletionAvailable {
                                Button("Empty Trash", role: .destructive) {
                                    confirmEmptyTrash = true
                                }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("empty-trash-button")
                            }
                        }
                        .padding(.vertical, 4)

                        ForEach(trashedPages) { page in
                            trashItemRow(page)
                        }
                    }
                    .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
                    .frame(maxWidth: 820, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .background(WorldsPalette.paper(for: colorScheme))
            }
        }
        .navigationTitle("Trash")
        .accessibilityIdentifier("trash-view")
        .alert("Empty Trash?", isPresented: $confirmEmptyTrash) {
            Button("Empty Trash", role: .destructive, action: onEmptyTrash)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("All \(trashedPages.count) items in Trash will be permanently removed. This action cannot be undone.")
        }
        .alert(
            "Delete \"\(itemToDeletePermanently?.title ?? "Untitled")\" permanently?",
            isPresented: Binding(get: { itemToDeletePermanently != nil }, set: { if !$0 { itemToDeletePermanently = nil } })
        ) {
            Button("Delete Permanently", role: .destructive) {
                if let item = itemToDeletePermanently {
                    onDeletePermanently(item.id)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This item will be permanently erased from the database.")
        }
    }

    private func trashItemRow(_ page: StoredPage) -> some View {
        HStack(spacing: 14) {
            Image(systemName: kindIcon(page.kind))
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 34, height: 34)
                .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(page.title.isEmpty ? String(localized: "Untitled") : page.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .lineLimit(1)

                Text("\(page.kind.capitalized) · Last modified \(formattedDate(page.updatedAt))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                onRestore(page.id)
            } label: {
                Label("Restore", systemImage: "arrow.uturn.backward")
                    .font(.subheadline)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Restore \(page.title)")

            if permanentDeletionAvailable {
                Button(role: .destructive) {
                    itemToDeletePermanently = page
                } label: {
                    Image(systemName: "trash")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Permanently delete \(page.title)")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .worldsGlass(cornerRadius: 12)
    }

    private func kindIcon(_ kind: String) -> String {
        switch kind {
        case "drawing": return "pencil.tip"
        case "document": return "doc.richtext"
        case "project": return "folder"
        case "gallery": return "photo.on.rectangle"
        case "presentation": return "rectangle.on.rectangle"
        case "stream": return "video"
        default: return "doc.text"
        }
    }

    private func formattedDate(_ epochMillis: Int64) -> String {
        guard epochMillis > 0 else { return "previously" }
        let date = Date(timeIntervalSince1970: TimeInterval(epochMillis) / 1000)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
