import Foundation
import WorldsModels

public enum GalleryError: Error, Equatable, Sendable {
    case invalidBlock, duplicateID, invalidAttachment, invalidIndex, missingItem, unsupportedMedia, invalidMetadata, notGallery, conflict, permissionDenied
}
public struct GalleryAttachment: Sendable, Equatable {
    public let id: String
    public let fileName: String
    public let mime: String
    public let size: Int64
    public let kind: String
    public init(id: String, fileName: String, mime: String, size: Int64, kind: String) {
        self.id = id; self.fileName = fileName; self.mime = mime; self.size = size; self.kind = kind
    }
}
public struct GalleryItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let attachmentID: String
    public let name: String
    public let mime: String
    public let size: Int64
    public let kind: String
    public let caption: String
    public var isImage: Bool { mime.hasPrefix("image/") }
    public var appearsInLightbox: Bool { !mime.hasPrefix("audio/") }
}
private extension JSONValue {
    var galleryObject: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
    var galleryString: String? { if case .string(let v) = self { return v }; return nil }
    var galleryInt: Int64? { if case .integer(let v) = self { return v }; return nil }
}

/// Canonical blocks remain open JSON. Unrecognized blocks and fields are kept.
public struct GalleryDocument: Sendable, Equatable {
    public private(set) var blocks: [JSONValue]
    public private(set) var metadata: JSONValue
    public init(blocks: [JSONValue], metadata: JSONValue) throws {
        guard metadata.galleryObject != nil else { throw GalleryError.invalidMetadata }
        var ids: Set<String> = []
        for block in blocks {
            guard let object = block.galleryObject, let id = object["id"]?.galleryString, !id.isEmpty, ids.insert(id).inserted,
                  let content = object["content"]?.galleryObject, content["type"]?.galleryString != nil else { throw GalleryError.invalidBlock }
            if content["type"]?.galleryString == "galleryItem" { _ = try Self.parseItem(block) }
        }
        self.blocks = blocks; self.metadata = metadata
    }
    public var items: [GalleryItem] { blocks.compactMap { try? Self.parseItem($0) } }
    public var view: String { metadata.galleryObject?["gallery"]?.galleryObject?["view"]?.galleryString ?? "grid" }
    public var attachmentIDs: [String] { items.map(\.attachmentID) }

    public mutating func add(_ attachment: GalleryAttachment) throws {
        let allowed = Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "m4a", "ogg", "flac"])
        let ext = (attachment.fileName as NSString).pathExtension.lowercased()
        guard allowed.contains(ext) else { throw GalleryError.unsupportedMedia }
        guard !attachment.id.isEmpty, attachment.size >= 0 else { throw GalleryError.invalidAttachment }
        var id: String
        let existing = Set(blocks.compactMap { $0.galleryObject?["id"]?.galleryString })
        repeat { id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() } while existing.contains(id)
        let attrs: [String: JSONValue] = ["bid": .string(id), "attachmentId": .string(attachment.id), "name": .string(attachment.fileName), "mime": .string(attachment.mime), "size": .integer(attachment.size), "kind": .string(attachment.kind), "caption": .string("")]
        blocks.append(.object(["id": .string(id), "content": .object(["type": .string("galleryItem"), "attrs": .object(attrs)])]))
    }
    public mutating func move(from: Int, to: Int) throws {
        let positions = galleryPositions()
        guard positions.indices.contains(from), positions.indices.contains(to) else { throw GalleryError.invalidIndex }
        guard from != to else { return }
        var entries = positions.map { blocks[$0] }
        let entry = entries.remove(at: from); entries.insert(entry, at: to)
        for (offset, position) in positions.enumerated() { blocks[position] = entries[offset] }
    }
    /// Removes a gallery block only. It never removes or modifies the attachment.
    public mutating func remove(itemID: String) throws {
        let matches = galleryPositions().filter { blocks[$0].galleryObject?["id"]?.galleryString == itemID }
        guard matches.count == 1, let position = matches.first else { throw GalleryError.missingItem }
        blocks.remove(at: position)
    }
    public func editableCaption(itemID: String) -> String? {
        let matches = galleryPositions().filter { blocks[$0].galleryObject?["id"]?.galleryString == itemID }
        guard matches.count == 1, let position = matches.first,
              let attrs = blocks[position].galleryObject?["content"]?.galleryObject?["attrs"]?.galleryObject else { return nil }
        guard let value = attrs["caption"] else { return "" }
        return value.galleryString
    }
    public mutating func setCaption(itemID: String, caption: String) throws {
        let matches = galleryPositions().filter { blocks[$0].galleryObject?["id"]?.galleryString == itemID }
        guard matches.count == 1, let position = matches.first, var block = blocks[position].galleryObject,
              var content = block["content"]?.galleryObject, var attrs = content["attrs"]?.galleryObject else { throw GalleryError.missingItem }
        if let existing = attrs["caption"], existing.galleryString == nil { throw GalleryError.invalidBlock }
        attrs["caption"] = .string(caption); content["attrs"] = .object(attrs); block["content"] = .object(content)
        blocks[position] = .object(block)
    }
    public mutating func setView(_ view: String) throws {
        guard ["grid", "list"].contains(view), var root = metadata.galleryObject else { throw GalleryError.invalidMetadata }
        if let gallery = root["gallery"], gallery != .null, gallery.galleryObject == nil { throw GalleryError.invalidMetadata }
        var gallery = root["gallery"]?.galleryObject ?? [:]; gallery["view"] = .string(view)
        root["gallery"] = .object(gallery); metadata = .object(root)
    }
    public func iconValue(itemID: String) throws -> String {
        guard let item = items.first(where: { $0.id == itemID }) else { throw GalleryError.missingItem }
        guard item.isImage else { throw GalleryError.unsupportedMedia }
        return "img:\(item.attachmentID)"
    }
    private func galleryPositions() -> [Int] {
        blocks.indices.filter { blocks[$0].galleryObject?["content"]?.galleryObject?["type"]?.galleryString == "galleryItem" }
    }
    private static func parseItem(_ value: JSONValue) throws -> GalleryItem {
        guard let block = value.galleryObject, let id = block["id"]?.galleryString,
              let content = block["content"]?.galleryObject, content["type"]?.galleryString == "galleryItem",
              let attrs = content["attrs"]?.galleryObject, let attachment = attrs["attachmentId"]?.galleryString, !attachment.isEmpty,
              let name = attrs["name"]?.galleryString, let mime = attrs["mime"]?.galleryString,
              let size = attrs["size"]?.galleryInt, size >= 0, let kind = attrs["kind"]?.galleryString else { throw GalleryError.invalidBlock }
        return GalleryItem(id: id, attachmentID: attachment, name: name, mime: mime, size: size, kind: kind, caption: attrs["caption"]?.galleryString ?? "")
    }
}

