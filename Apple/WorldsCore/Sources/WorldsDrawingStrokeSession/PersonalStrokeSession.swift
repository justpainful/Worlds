import Foundation
import WorldsDrawing
import WorldsDrawingNativeWrites

public enum StrokeSessionError: Error, Equatable {
    case busy, retryRequired, staleRevision, invalidScene, missingLayer, lockedLayer, alphaLocked, missingFrame, assetBrushUnsupported, noPendingOperation
}

private struct DrawingEnvelope: Decodable {
    let value: DrawingSnapshot
}
private struct DrawingSnapshot: Decodable {
    let revision: Int64
    let scene: Scene
}
private struct Scene: Decodable {
    let layers: [String: Layer]
    let frames: [String: Frame]
    let nodeOrder: [String]
}
private struct Layer: Decodable {
    let locked: Bool
    let alphaLocked: Bool
    let parentId: String?
}
private struct Frame: Decodable { let id: String }

/// An isolated operation bridge, not an interactive canvas. The host must own
/// and authorize its database, supply a real actor identity and keep its scope.
/// Original Rust validation and personal-only restrictions remain authoritative.
public actor PersonalStrokeSession {
    private let writer: PersonalDrawingWriter
    private let pageID: String
    private var pending: Data?
    private var busy = false

    public init(writer: PersonalDrawingWriter, pageID: String) throws {
        guard !pageID.isEmpty else { throw StrokeSessionError.invalidScene }
        self.writer = writer; self.pageID = pageID
    }

    /// The caller must pass the revision displayed while capturing the stroke.
    /// If the response is lost, retryPending reuses the exact same operation ID.
    public func submit(samples: [ToolSample], brush: ToolBrush, tool: StrokeTool,
                       actor: String, expectedRevision: Int64, timestamp: Int64,
                       layerID: String, frameID: String, seed: Int) async throws -> Data {
        guard !busy else { throw StrokeSessionError.busy }
        guard pending == nil else { throw StrokeSessionError.retryRequired }
        guard brush.tipAssetId == nil else { throw StrokeSessionError.assetBrushUnsupported }
        busy = true; defer { busy = false }
        let envelope = try JSONDecoder().decode(DrawingEnvelope.self, from: await writer.load(pageID: pageID))
        let document = envelope.value
        guard document.revision == expectedRevision else { throw StrokeSessionError.staleRevision }
        guard document.scene.frames[frameID]?.id == frameID else { throw StrokeSessionError.missingFrame }
        var ancestor: String? = layerID
        var seen = Set<String>()
        var alphaLocked = false
        while let id = ancestor {
            guard seen.insert(id).inserted else { throw StrokeSessionError.invalidScene }
            guard let layer = document.scene.layers[id] else { throw StrokeSessionError.missingLayer }
            if layer.locked { throw StrokeSessionError.lockedLayer }
            alphaLocked = alphaLocked || layer.alphaLocked
            ancestor = layer.parentId
        }
        if case .eraser = tool, alphaLocked { throw StrokeSessionError.alphaLocked }
        let operation = try StrokeOperationBuilder.make(samples: samples, brush: brush, tool: tool,
            nodeID: UUID().uuidString, operationID: UUID().uuidString, actor: actor,
            revision: expectedRevision, timestamp: timestamp, layerID: layerID, frameID: frameID,
            nodeOrder: document.scene.nodeOrder, seed: seed, alphaLock: alphaLocked)
        pending = operation
        let result = try await writer.apply(pageID: pageID, changeJSON: operation)
        pending = nil
        return result
    }

    public func retryPending() async throws -> Data {
        guard !busy else { throw StrokeSessionError.busy }
        guard let operation = pending else { throw StrokeSessionError.noPendingOperation }
        busy = true; defer { busy = false }
        let result = try await writer.apply(pageID: pageID, changeJSON: operation)
        pending = nil
        return result
    }
}
