import Foundation

/// A row derived solely from an already-authorized personal snapshot.
public struct PersonalHierarchyRow: Identifiable, Sendable {
    public let page: StoredPage
    public let depth: Int
    public let hasChildren: Bool
    public let isExpanded: Bool
    /// The original parent is absent, filtered, or part of a cycle. No parent
    /// identity or title is inferred for this row.
    public let detached: Bool
    public var id: String { page.id }
}

public enum PersonalPageHierarchy {
    /// Matches the source sidebar's personal, non-archived and non-template
    /// scope. Detached components remain reachable without revealing a hidden
    /// parent. Depth is visually capped and traversal is iterative.
    public static func rows(pages: [StoredPage], expanded: Set<String>) -> [PersonalHierarchyRow] {
        let eligible = pages.filter { !$0.archived && $0.kind != "template" }
        var byID: [String: StoredPage] = [:]
        for page in eligible where byID[page.id] == nil { byID[page.id] = page }
        var children: [String: [String]] = [:]
        var roots: [(String, Bool)] = []
        for page in eligible where byID[page.id] != nil {
            if let parent = page.parentID, parent != page.id, byID[parent] != nil {
                children[parent, default: []].append(page.id)
            } else {
                roots.append((page.id, page.parentID != nil))
            }
        }
        // Determine components independently of expansion, so a collapsed
        // descendant does not appear again as a detached root.
        var covered = Set<String>()
        func cover(_ root: String) {
            var work = [root]
            while let id = work.popLast() {
                guard covered.insert(id).inserted else { continue }
                work.append(contentsOf: children[id] ?? [])
            }
        }
        for root in roots { cover(root.0) }
        for page in eligible where !covered.contains(page.id) {
            roots.append((page.id, true))
            cover(page.id)
        }
        var rows: [PersonalHierarchyRow] = []
        var emitted = Set<String>()
        var work: [(String, Int, Bool)] = roots.reversed().map { ($0.0, 0, $0.1) }
        while let (id, depth, detached) = work.popLast() {
            guard emitted.insert(id).inserted, let page = byID[id] else { continue }
            let next = (children[id] ?? []).filter { !emitted.contains($0) }
            let open = !next.isEmpty && expanded.contains(id)
            rows.append(PersonalHierarchyRow(page: page, depth: depth, hasChildren: !next.isEmpty, isExpanded: open, detached: detached))
            if open {
                for child in next.reversed() { work.append((child, min(depth + 1, 8), false)) }
            }
        }
        return rows
    }

    /// Opens the visible parent chain for a search result or linked page.
    public static func expandedAncestors(of id: String, pages: [StoredPage]) -> Set<String> {
        let byID = Dictionary(pages.filter { !$0.archived && $0.kind != "template" }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var ancestors = Set<String>()
        var current = id
        while let page = byID[current], let parent = page.parentID,
              parent != current, byID[parent] != nil, ancestors.insert(parent).inserted {
            current = parent
        }
        ancestors.remove(id)
        return ancestors
    }
}
