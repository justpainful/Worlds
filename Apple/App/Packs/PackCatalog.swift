import Foundation

/// Packs on Apple (docs/PACKS.md, Design 4): the same definitions as the
/// desktop, read from packs.json, which the desktop exports with every label
/// in English and Arabic (src/packs/export.test.ts keeps it current). Items
/// are resources of kind "pack.kind" with their fields under metadata.item.
struct PackText: Decodable, Hashable {
    let en: String
    let ar: String

    /// The label in the interface language.
    var text: String {
        let arabic = Locale.current.language.languageCode?.identifier == "ar"
        return arabic && !ar.isEmpty ? ar : en
    }
}

struct PackOption: Decodable, Hashable {
    let id: String
    let label: PackText
    let color: String?
}

struct PackField: Decodable, Hashable {
    let id: String
    let label: PackText
    let type: String
    let options: [PackOption]?
    let to: String?
    let currency: String?
    let detailOnly: Bool
}

struct PackKind: Decodable, Hashable {
    let id: String
    let kind: String
    let dataKey: String
    let label: PackText
    let plural: PackText
    let icon: String
    let fields: [PackField]
    let dateField: String?
    let stageField: String?
    let doneField: String?

    /// Fields a list shows (the rest are on the item).
    var listFields: [PackField] { fields.filter { !$0.detailOnly } }
}

struct PackDefinition: Decodable, Hashable {
    let id: String
    let family: String
    let label: PackText
    let blurb: PackText
    let icon: String
    let kinds: [PackKind]
    let views: [PackViewDef]?
    let sidebar: [String]?
    let screens: [PackScreenDef]?
    let stats: [PackStat]?
    let alerts: [PackAlert]?
    let prompts: [PackPrompt]?

    func kind(id: String) -> PackKind? { kinds.first { $0.id == id } }
    /// The views the pack puts first, in its order.
    var mainViews: [PackViewDef] { (sidebar ?? []).compactMap { id in views?.first { $0.id == id } } }
}

struct PackFamily: Decodable, Hashable {
    let id: String
    let label: PackText
    let icon: String
}

struct PackViewDef: Decodable, Hashable {
    let id: String
    let label: PackText
    let type: String
    let kind: String
    let groupBy: String?
    let columns: [String]?
}

struct PackScreenDef: Decodable, Hashable {
    let id: String
    let label: PackText
    let component: String
}

struct PackPrompt: Decodable, Hashable {
    let label: PackText
    let prompt: PackText
}

struct PackCatalog: Decodable {
    let packs: [PackDefinition]
    let families: [PackFamily]?

    /// The pack and kind behind a stored kind, if a pack defines it.
    func kind(of stored: String) -> (pack: PackDefinition, kind: PackKind)? {
        for pack in packs {
            if let kind = pack.kinds.first(where: { $0.kind == stored }) { return (pack, kind) }
        }
        return nil
    }

    /// The catalog the app ships, read once.
    static let shipped: PackCatalog? = {
        guard let url = Bundle.main.url(forResource: "packs", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(PackCatalog.self, from: data)
    }()

    /// A pack kind is "pack.kind" (teacher.class), the shape the desktop accepts.
    static func isPackKind(_ kind: String) -> Bool {
        let parts = kind.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, kind.count <= 64 else { return false }
        return parts.allSatisfy { part in
            guard let first = part.first, first.isLowercase, first.isASCII else { return false }
            return part.allSatisfy { ($0.isLowercase || $0.isNumber) && $0.isASCII }
        }
    }
}

/// What a field shows: text, a choice's label, a number with its currency, a tick.
func packFieldValue(_ field: PackField, in data: [String: Any], titleOf: (String) -> String?) -> String? {
    guard let raw = data[field.id], !(raw is NSNull) else { return nil }
    switch field.type {
    case "choice", "stage":
        guard let id = raw as? String else { return nil }
        return field.options?.first(where: { $0.id == id })?.label.text
    case "checkbox":
        return (raw as? Bool) == true ? "\u{2713}" : nil
    case "link":
        return (raw as? String).flatMap(titleOf)
    case "money":
        guard let n = raw as? NSNumber else { return nil }
        return "\(n.stringValue) \(field.currency ?? "SAR")"
    case "number":
        return (raw as? NSNumber)?.stringValue
    default:
        let text = "\(raw)"
        return text.isEmpty ? nil : text
    }
}
