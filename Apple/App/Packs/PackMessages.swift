import SwiftUI
import WorldsPersistence

/*
 * Messages to people outside Worlds about a pack item (docs/PACKS.md), as on
 * desktop (src/packs/messages.ts) and Android: a note to a parent about an
 * absence, a payment reminder. Worlds fills it in and opens it in the
 * person's own WhatsApp or mail app, where they send it themselves.
 */

struct PackMessageDef: Decodable, Hashable, Identifiable {
    let id: String
    let label: PackText
    let via: String?
    let fields: [String]
    let name: String?
    let text: PackText
    let `when`: [PackCondition]
    let done: [String: PackValue]?
}

struct MessageDraft: Equatable {
    enum Channel { case whatsapp, email }
    let channel: Channel
    let to: String
    let name: String
    let text: String
}

enum PackMessages {
    /// Digits with the country code, as WhatsApp wants them; a local Saudi mobile gets 966. "" when not a number.
    static func whatsappNumber(_ raw: String) -> String {
        var digits = String(raw.compactMap { ch -> Character? in
            guard let v = ch.wholeNumberValue else { return nil }
            return Character(String(v))
        })
        if digits.hasPrefix("00") { digits.removeFirst(2) }
        if digits.count == 10, digits.hasPrefix("05") { digits = "966" + digits.dropFirst() }
        return (8...15).contains(digits.count) ? digits : ""
    }

    static func url(_ d: MessageDraft, subject: String = "") -> URL? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?#")
        let enc = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        switch d.channel {
        case .whatsapp: return URL(string: "https://wa.me/\(d.to)?text=\(enc(d.text))")
        case .email:
            let query = (subject.isEmpty ? [] : ["subject=\(enc(subject))"]) + ["body=\(enc(d.text))"]
            return URL(string: "mailto:\(d.to)?\(query.joined(separator: "&"))")
        }
    }

    static func offered(_ m: PackMessageDef, data: [String: Any], today: String = PackRules.today()) -> Bool {
        m.when.allSatisfy { PackRules.matches($0, data, today: today) }
    }

    /// The message filled in for one item, or nil when there is no one to send it to.
    static func draft(_ m: PackMessageDef, pack: PackDefinition, kind: PackKind, item: PackRow, rowOf: @escaping (String) -> PackRow?) -> MessageDraft? {
        let titleOf = { (id: String) in rowOf(id)?.title }
        let viaField = m.via.flatMap { v in kind.fields.first { $0.id == v } }
        let viaRow = viaField.flatMap { item.data[$0.id] as? String }.flatMap(rowOf)
        let viaKind = viaField?.to.flatMap { pack.kind(id: $0) }
        if m.via != nil && (viaRow == nil || viaKind == nil) { return nil }
        let targetKind = viaKind ?? kind
        let targetData = viaRow?.data ?? item.data

        var channel: MessageDraft.Channel?
        var to = ""
        for id in m.fields {
            guard let f = targetKind.fields.first(where: { $0.id == id }),
                  let v = (targetData[id] as? String)?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { continue }
            if f.type == "phone" {
                to = whatsappNumber(v)
                if !to.isEmpty { channel = .whatsapp }
            } else if f.type == "email", v.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil {
                to = v
                channel = .email
            }
            if channel != nil { break }
        }
        guard let channel else { return nil }

        func show(_ k: PackKind, _ d: [String: Any], _ id: String) -> String {
            k.fields.first { $0.id == id }.flatMap { packFieldValue($0, in: d, titleOf: titleOf) } ?? ""
        }
        var text = m.text.text
        let pattern = try? NSRegularExpression(pattern: #"\{([a-zA-Z]+)(?:\.([a-zA-Z]+))?\}"#)
        for match in (pattern?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []).reversed() {
            guard let whole = Range(match.range, in: text), let aRange = Range(match.range(at: 1), in: text) else { continue }
            let a = String(text[aRange])
            let b = Range(match.range(at: 2), in: text).map { String(text[$0]) }
            let value: String?
            if a == "title" && b == nil { value = item.title }
            else if let via = m.via, a == via { value = b.map { show(viaKind!, viaRow!.data, $0) } ?? viaRow?.title }
            else if b == nil && kind.fields.contains(where: { $0.id == a }) { value = show(kind, item.data, a) }
            else { value = nil }
            if let value { text.replaceSubrange(whole, with: value) }
        }
        let name = m.name.flatMap { targetData[$0] as? String } ?? ""
        return MessageDraft(channel: channel, to: to, name: name, text: text)
    }
}

/// Shows the filled message, opens it in WhatsApp or mail, then records that it was sent.
struct PackMessageSheet: View {
    let message: PackMessageDef
    let draft: MessageDraft?
    let subject: String
    let onSent: ([String: PackValue]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var text = ""
    @State private var opened = false

    var body: some View {
        NavigationStack {
            Form {
                if let draft {
                    Section("To") {
                        Text([draft.name, draft.channel == .email ? draft.to : "+\(draft.to)"].filter { !$0.isEmpty }.joined(separator: "  "))
                    }
                    Section("Message") {
                        TextEditor(text: $text).frame(minHeight: 140)
                    }
                    Text(draft.channel == .email ? "It opens in your mail app, where you send it yourself." : "It opens in WhatsApp, where you send it yourself.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("There is no one to send this to yet. Add a phone number or email first.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle(message.label.text)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if let draft {
                    ToolbarItem(placement: .confirmationAction) {
                        if opened, let done = message.done {
                            Button("It was sent") { onSent(done); dismiss() }
                        } else {
                            Button(draft.channel == .email ? "Open in Mail" : "Open in WhatsApp") {
                                if let url = PackMessages.url(MessageDraft(channel: draft.channel, to: draft.to, name: draft.name, text: text), subject: subject) {
                                    openURL(url)
                                    opened = true
                                }
                            }
                            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 360)
        #endif
        .onAppear { text = draft?.text ?? "" }
    }
}
