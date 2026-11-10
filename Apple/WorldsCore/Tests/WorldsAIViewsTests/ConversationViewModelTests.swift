import Foundation
import XCTest
@testable import WorldsAIViews

private struct FixtureError: LocalizedError { var errorDescription: String? { "Fixture failure" } }
private struct FixtureService: ConversationService {
    let failsLoad: Bool
    let failsSend: Bool
    func load(conversationID: String) async throws -> [ConversationMessage] {
        if failsLoad { throw FixtureError() }
        return [ConversationMessage(id: "saved", role: .user, text: "Saved")]
    }
    func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> {
        AsyncThrowingStream { continuation in
            if failsSend { continuation.finish(throwing: FixtureError()); return }
            continuation.yield(.accepted([ConversationMessage(id: "saved", role: .user, text: text)]))
            continuation.yield(.textDelta("Reply"))
            continuation.finish()
        }
    }
    func cancel(runID: UUID) async throws {}
}

@MainActor
final class ConversationViewModelTests: XCTestCase {
    func testLoadFailurePreventsSendingAndKeepsDraft() async {
        let model = ConversationViewModel(conversationID: "fixture", service: FixtureService(failsLoad: true, failsSend: false))
        await model.load(); model.draft = "hello"; await model.send()
        XCTAssertFalse(model.loaded); XCTAssertFalse(model.running); XCTAssertEqual(model.draft, "hello")
        XCTAssertEqual(model.error, "Fixture failure")
    }
    func testFailedSendPreservesDraft() async {
        let model = ConversationViewModel(conversationID: "fixture", service: FixtureService(failsLoad: false, failsSend: true))
        await model.load(); model.draft = "hello"; await model.send()
        XCTAssertEqual(model.draft, "hello"); XCTAssertFalse(model.running)
        XCTAssertEqual(model.error, "Fixture failure")
    }
    func testAcceptedMessageClearsDraftAndReloadsSavedMessages() async {
        let model = ConversationViewModel(conversationID: "fixture", service: FixtureService(failsLoad: false, failsSend: false))
        await model.load(); model.draft = "hello"; await model.send()
        XCTAssertEqual(model.draft, ""); XCTAssertEqual(model.messages.first?.text, "Saved")
        XCTAssertEqual(model.streamedText, ""); XCTAssertFalse(model.running)
    }
}

private final class ControlledService: ConversationService, @unchecked Sendable {
    private let stream: AsyncThrowingStream<ConversationEvent, Error>
    private let continuation: AsyncThrowingStream<ConversationEvent, Error>.Continuation
    init() {
        let pair = AsyncThrowingStream<ConversationEvent, Error>.makeStream()
        stream = pair.stream; continuation = pair.continuation
    }
    func load(conversationID: String) async throws -> [ConversationMessage] { [] }
    func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> { stream }
    func cancel(runID: UUID) async throws { continuation.finish(throwing: CancellationError()) }
    func emit(_ event: ConversationEvent) { continuation.yield(event) }
}

extension ConversationViewModelTests {
    func testStreamingAndCancellation() async {
        let service = ControlledService()
        let model = ConversationViewModel(conversationID: "fixture", service: service)
        await model.load(); model.draft = "Question"
        let run = Task { await model.send() }
        for _ in 0..<200 {
            if model.running { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(model.running)
        service.emit(.textDelta("Partial answer"))
        for _ in 0..<200 {
            if !model.streamedText.isEmpty { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.streamedText, "Partial answer")
        await model.stop(); await run.value
        XCTAssertFalse(model.running)
        XCTAssertEqual(model.draft, "Question")
        XCTAssertEqual(model.streamedText, "Partial answer")
    }
}
