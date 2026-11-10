import Foundation

/// Wire fields emitted by the existing Rust store (`store::PageMeta`).
/// Kind stays a string so an unknown future resource is not destroyed on import.
public struct ResourceSummary: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let icon: String?
    public let cover: String?
    public let parentId: String?
    public let sortKey: Double
    public let ownerId: String?
    public let kind: String
    public let templateCategory: String?
    public let pinned: Bool
    public let pinOrder: Double?
    public let favorite: Bool
    public let archived: Bool
    public let deletedAt: Int64?
    public let preview: String
    public let createdAt: Int64
    public let updatedAt: Int64
    public let openedAt: Int64?
    public let properties: JSONValue
    public let look: JSONValue
}

/// Editor content is represented as open JSON instead of flattening rich blocks.
public struct ResourceBlock: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let pageId: String
    public let type: String
    public let order: Double
    public let content: JSONValue
    public let properties: JSONValue
    public let direction: String
    public let createdAt: Int64
    public let updatedAt: Int64
}
