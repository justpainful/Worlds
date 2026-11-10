import Foundation
import Combine
import WorldsDrawing
import WorldsDrawingStrokeSession

/// Holds captured input until the original-format write succeeds. Hosts must
/// establish database identity and permission before creating this controller.
@MainActor public final class PencilStrokeController: ObservableObject {
    @Published public private(set) var saving = false
    @Published public private(set) var error: String?
    @Published public private(set) var hasUnresolvedInput = false
    private let session: PersonalStrokeSession
    private var retainedInput: PencilStrokeBuffer?
    private var operationSubmitted = false
    public init(session: PersonalStrokeSession) { self.session = session }

    public func save(_ buffer: PencilStrokeBuffer, brush: ToolBrush, tool: StrokeTool,
                     actor: String, revision: Int64, timestamp: Int64,
                     layerID: String, frameID: String, seed: Int) async -> Data? {
        guard !saving, retainedInput == nil else { return nil }
        retainedInput = buffer; hasUnresolvedInput = true; saving = true; error = nil
        defer { saving = false }
        do {
            let samples = try buffer.finalized(brush: brush)
            operationSubmitted = true
            let result = try await session.submit(samples: samples, brush: brush, tool: tool, actor: actor,
                expectedRevision: revision, timestamp: timestamp, layerID: layerID, frameID: frameID, seed: seed)
            retainedInput = nil; operationSubmitted = false; hasUnresolvedInput = false
            return result
        } catch {
            operationSubmitted = await session.hasPendingOperation()
            self.error = "The stroke was not confirmed. Keep this session open while you recover it: \(error)"
            return nil
        }
    }

    /// The exact same operation may be retried only after submission.
    public var canRetryPending: Bool { operationSubmitted && retainedInput != nil }

    /// Discard is safe only before an operation has been submitted to storage.
    @discardableResult public func discardUnsubmitted() -> Bool {
        guard !saving, retainedInput != nil, !operationSubmitted else { return false }
        retainedInput = nil; hasUnresolvedInput = false; error = nil
        return true
    }
    public func retry() async -> Data? {
        guard !saving, operationSubmitted else { return nil }
        saving = true; defer { saving = false }
        do {
            let result = try await session.retryPending()
            retainedInput = nil; operationSubmitted = false; hasUnresolvedInput = false; error = nil
            return result
        } catch {
            self.error = "The stroke is still unconfirmed: \(error)"
            return nil
        }
    }
    /// Returns the captured original samples without treating them as saved.
    public func recoverInput() -> PencilStrokeBuffer? { retainedInput }
}
