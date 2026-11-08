import Foundation

/// A deliberately limited, single-pane personal page session. Identifiers are
/// filtered against the current authorized snapshot whenever the session opens.
public struct PersonalTabSession: Equatable, Sendable {
    public private(set) var pageIDs: [String]
    public private(set) var activeID: String?
    public init(pageIDs: [String] = [], activeID: String? = nil, eligibleIDs: Set<String>) {
        var seen = Set<String>()
        let normalized = Array(pageIDs.filter { Self.validID($0) && eligibleIDs.contains($0) && seen.insert($0).inserted }.prefix(20))
        self.pageIDs = normalized
        self.activeID = activeID.flatMap { normalized.contains($0) ? $0 : nil } ?? normalized.first
    }
    public mutating func select(_ id: String, eligibleIDs: Set<String>) {
        guard Self.validID(id), eligibleIDs.contains(id) else { return }
        if pageIDs.contains(id) { activeID = id; return }
        if let activeID, let index = pageIDs.firstIndex(of: activeID) { pageIDs[index] = id }
        else if pageIDs.isEmpty { pageIDs = [id] }
        else { return }
        activeID = id
    }
    @discardableResult public mutating func openTab(_ id: String, eligibleIDs: Set<String>) -> Bool {
        guard Self.validID(id), eligibleIDs.contains(id) else { return false }
        if pageIDs.contains(id) { activeID = id; return true }
        guard pageIDs.count < 20 else { return false }
        let index = activeID.flatMap { pageIDs.firstIndex(of: $0) }.map { $0 + 1 } ?? pageIDs.count
        pageIDs.insert(id, at: index); activeID = id; return true
    }
    public mutating func close(_ id: String) {
        guard let index = pageIDs.firstIndex(of: id) else { return }
        pageIDs.remove(at: index)
        if activeID == id { activeID = pageIDs.isEmpty ? nil : pageIDs[min(index, pageIDs.count - 1)] }
    }
    public mutating func filter(eligibleIDs: Set<String>) {
        self = PersonalTabSession(pageIDs: pageIDs, activeID: activeID, eligibleIDs: eligibleIDs)
    }
    private static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 512 && !id.utf8.contains(0)
    }
}

public struct PersonalTabPreferences {
    private let defaults: UserDefaults
    private let prefix: String
    public init(defaults: UserDefaults = .standard, prefix: String = "worlds.personal-tabs.") {
        self.defaults = defaults; self.prefix = prefix
    }
    public func load(copyID: UUID, eligibleIDs: Set<String>) -> PersonalTabSession {
        let value = defaults.dictionary(forKey: prefix + copyID.uuidString) ?? [:]
        guard let ids = value["pages"] as? [String], ids.count <= 20,
              ids.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 && !$0.utf8.contains(0) }) else {
            return PersonalTabSession(eligibleIDs: eligibleIDs)
        }
        return PersonalTabSession(pageIDs: ids, activeID: value["active"] as? String, eligibleIDs: eligibleIDs)
    }
    public func save(_ session: PersonalTabSession, copyID: UUID, eligibleIDs: Set<String>) {
        let safe = PersonalTabSession(pageIDs: session.pageIDs, activeID: session.activeID, eligibleIDs: eligibleIDs)
        defaults.set(["pages": safe.pageIDs, "active": safe.activeID ?? ""], forKey: prefix + copyID.uuidString)
    }
}
