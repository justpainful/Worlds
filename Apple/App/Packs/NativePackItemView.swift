import SwiftUI
import WorldsPersistence

/// A pack item in the reader (docs/PACKS.md, Design 4): its kind, then each
/// field with a value, labelled in the interface language from the shipped
/// definitions. Editing stays on desktop and Android for now, as it does for
/// planning and Study items here.
struct NativePackItemView: View {
    let page: StoredPage
    var titleOf: (String) -> String? = { _ in nil }

    private var definition: (pack: PackDefinition, kind: PackKind)? { PackCatalog.shipped?.kind(of: page.kind) }

    private var fields: [String: Any] {
        guard let data = page.metadataJSON.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        let key = definition?.kind.dataKey ?? "item"
        return root[key] as? [String: Any] ?? [:]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let def = definition {
                HStack(spacing: 8) {
                    Text(def.kind.label.text)
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.accentColor.opacity(0.15), in: Capsule())
                    Text(def.pack.label.text)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                let values = def.kind.fields.compactMap { field -> (PackField, String)? in
                    packFieldValue(field, in: fields, titleOf: titleOf).map { (field, $0) }
                }
                if values.isEmpty {
                    Text("No details yet")
                        .font(.body)
                        .foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(values.enumerated()), id: \.offset) { index, pair in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pair.0.label.text)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(pair.1)
                                    .font(.body)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 10)
                            .padding(.horizontal, 14)
                            .accessibilityElement(children: .combine)
                            if index < values.count - 1 {
                                Divider().padding(.leading, 14)
                            }
                        }
                    }
                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                }
            } else {
                // A pack this version does not ship yet: kept as it is, shown plainly.
                Text("This item belongs to a pack this version of Worlds does not have.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("pack-item")
    }
}
