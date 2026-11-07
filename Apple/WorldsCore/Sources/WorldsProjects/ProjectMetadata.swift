import Foundation
import WorldsModels

public enum ProjectError: Error, Equatable, Sendable {
    case invalidMetadata, invalidStatus, invalidDate, invalidLinks, invalidResource, conflict, notProject
}
public struct ProjectResource: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let kind: String
    public let parentID: String?
    public let archived: Bool
    public let deletedAt: Int64?
    public let sortKey: Double
    public let createdAt: Int64
    public let updatedAt: Int64
    public init(id: String, title: String, kind: String, parentID: String?, archived: Bool, deletedAt: Int64?, sortKey: Double, createdAt: Int64, updatedAt: Int64) {
        self.id = id; self.title = title; self.kind = kind; self.parentID = parentID; self.archived = archived; self.deletedAt = deletedAt; self.sortKey = sortKey; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}
public enum ProjectChange: Sendable {
    case status(String), start(String?), due(String?), description(String), link(String), unlink(String)
}

/// The original page metadata remains canonical, including unknown fields.
public struct ProjectMetadata: Sendable, Equatable {
    public private(set) var source: JSONValue
    public init(source: JSONValue) throws {
        guard case .object(let metadata) = source else { throw ProjectError.invalidMetadata }
        if let project = metadata["project"], project != .null, project.projectObject == nil { throw ProjectError.invalidMetadata }
        self.source = source
    }
    public static var newProject: ProjectMetadata {
        try! ProjectMetadata(source: .object(["project": .object(["status": .string("active"), "start": .null, "due": .null, "description": .string(""), "links": .array([])])]))
    }
    private var fields: [String: JSONValue] { source.projectObject?["project"]?.projectObject ?? [:] }
    public var status: String { fields["status"]?.projectString ?? "active" }
    public var start: String? { fields["start"]?.projectString }
    public var due: String? { fields["due"]?.projectString }
    public var description: String { fields["description"]?.projectString ?? "" }
    public var links: [String] { fields["links"]?.projectArray?.compactMap(\.projectString) ?? [] }

    public mutating func apply(_ change: ProjectChange, projectID: String, resources: [ProjectResource]) throws {
        guard case .object(var metadata) = source else { throw ProjectError.invalidMetadata }
        var project = fields
        switch change {
        case .status(let value):
            guard ["planned", "active", "paused", "done"].contains(value) else { throw ProjectError.invalidStatus }
            project["status"] = .string(value)
        case .start(let value):
            guard value == nil || validDate(value!) else { throw ProjectError.invalidDate }
            project["start"] = value.map(JSONValue.string) ?? .null
        case .due(let value):
            guard value == nil || validDate(value!) else { throw ProjectError.invalidDate }
            project["due"] = value.map(JSONValue.string) ?? .null
        case .description(let value): project["description"] = .string(value)
        case .link(let target):
            let existing = try checkedLinks(project["links"])
            let inside = Set(Self.children(projectID: projectID, resources: resources).map(\.id))
            guard target != projectID, !existing.contains(target), !inside.contains(target),
                  resources.filter({ $0.id == target && $0.deletedAt == nil && $0.kind != "template" }).count == 1 else { throw ProjectError.invalidResource }
            project["links"] = .array((existing + [target]).map(JSONValue.string))
        case .unlink(let target):
            let existing = try checkedLinks(project["links"])
            project["links"] = .array(existing.filter { $0 != target }.map(JSONValue.string))
        }
        metadata["project"] = .object(project)
        source = .object(metadata)
    }
    public static func children(projectID: String, resources: [ProjectResource]) -> [ProjectResource] {
        resources.filter { $0.parentID == projectID && $0.kind != "template" && $0.deletedAt == nil && !$0.archived }
            .sorted { $0.sortKey == $1.sortKey ? $0.createdAt < $1.createdAt : $0.sortKey < $1.sortKey }
    }
    /// Linked resources retain their original parent and include archived items,
    /// matching ProjectView. Only caller-authorized resources may be supplied.
    public func linked(resources: [ProjectResource]) -> [ProjectResource] {
        let lookup = Dictionary(resources.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return links.compactMap { lookup[$0] }.filter { $0.deletedAt == nil }
    }
}
private extension JSONValue {
    var projectObject: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    var projectArray: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var projectString: String? { if case .string(let value) = self { return value }; return nil }
}
private func checkedLinks(_ value: JSONValue?) throws -> [String] {
    guard let value else { return [] }
    guard case .array(let list) = value else { throw ProjectError.invalidLinks }
    let strings = list.compactMap(\.projectString)
    // Unlinking by ID removes every match. Reject ambiguous legacy duplicates
    // instead of silently removing more entries than the user selected.
    guard strings.count == list.count, Set(strings).count == strings.count else { throw ProjectError.invalidLinks }
    return strings
}
private func validDate(_ value: String) -> Bool {
    let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
    guard pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
          value.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || $0 == "-" }),
          let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]), year >= 1 else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return false }
    let roundtrip = calendar.dateComponents([.year, .month, .day], from: date)
    return roundtrip.year == year && roundtrip.month == month && roundtrip.day == day
}
