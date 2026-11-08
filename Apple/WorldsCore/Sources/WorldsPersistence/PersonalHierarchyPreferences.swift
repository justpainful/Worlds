import Foundation

/// Sidebar preferences are scoped to an independent local-copy identifier.
/// No database paths or page contents are stored.
public struct PersonalHierarchyState: Equatable, Sendable {
    public var enabled: Bool
    public var expanded: Set<String>
    public init(enabled: Bool, expanded: Set<String>) { self.enabled = enabled; self.expanded = expanded }
}

public struct PersonalHierarchyPreferences {
    private let defaults: UserDefaults
    private let prefix: String
    public init(defaults: UserDefaults = .standard, prefix: String = "worlds.personal-hierarchy.") {
        self.defaults = defaults; self.prefix = prefix
    }
    public func load(copyID: UUID, eligibleIDs: Set<String>) -> PersonalHierarchyState {
        let key = prefix + copyID.uuidString
        guard let value = defaults.dictionary(forKey: key), let enabled = value["enabled"] as? Bool,
              let stored = value["expanded"] as? [String], stored.count <= 5_000 else {
            return PersonalHierarchyState(enabled: false, expanded: [])
        }
        let ids = stored.filter { !$0.isEmpty && $0.utf8.count <= 512 && eligibleIDs.contains($0) }
        return PersonalHierarchyState(enabled: enabled, expanded: Set(ids))
    }
    public func save(_ state: PersonalHierarchyState, copyID: UUID, eligibleIDs: Set<String>) {
        let ids = state.expanded.filter { !$0.isEmpty && $0.utf8.count <= 512 && eligibleIDs.contains($0) }.sorted()
        defaults.set(["enabled": state.enabled, "expanded": Array(ids.prefix(5_000))], forKey: prefix + copyID.uuidString)
    }
}
