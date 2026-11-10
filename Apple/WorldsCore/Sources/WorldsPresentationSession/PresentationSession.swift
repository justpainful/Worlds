import Foundation
import WorldsPresentations

public enum PresentationSessionError: Error, Equatable {
    case emptyDeck, duplicateSlideID, invalidIndex, lastSlide
}

/// An isolated editing session. The owner must provide an atomic conflict-aware
/// store and permission checks before persisting the resulting blocks.
public struct PresentationSession {
    public private(set) var slides: [SlideBlock]
    private var undoStack: [[SlideBlock]] = []
    private var redoStack: [[SlideBlock]] = []
    private let historyLimit = 120

    public init(slides: [SlideBlock]) throws {
        guard !slides.isEmpty else { throw PresentationSessionError.emptyDeck }
        guard Set(slides.map(\.id)).count == slides.count else { throw PresentationSessionError.duplicateSlideID }
        self.slides = slides
    }
    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }

    private mutating func commit(_ next: [SlideBlock]) {
        guard next != slides else { return }
        undoStack.append(slides)
        if undoStack.count > historyLimit { undoStack.removeFirst() }
        redoStack.removeAll()
        slides = next
    }
    public mutating func update(at index: Int, _ edit: (inout SlideBlock) throws -> Void) throws {
        guard slides.indices.contains(index) else { throw PresentationSessionError.invalidIndex }
        var updated = slides[index]
        try edit(&updated)
        guard updated.id == slides[index].id else { throw PresentationSessionError.duplicateSlideID }
        var next = slides; next[index] = updated
        commit(next)
    }
    public mutating func insert(_ slide: SlideBlock, at index: Int) throws {
        guard (0...slides.count).contains(index) else { throw PresentationSessionError.invalidIndex }
        guard !slides.contains(where: { $0.id == slide.id }) else { throw PresentationSessionError.duplicateSlideID }
        var next = slides; next.insert(slide, at: index); commit(next)
    }
    public mutating func remove(at index: Int) throws {
        guard slides.indices.contains(index) else { throw PresentationSessionError.invalidIndex }
        guard slides.count > 1 else { throw PresentationSessionError.lastSlide }
        var next = slides; next.remove(at: index); commit(next)
    }
    public mutating func move(from: Int, to: Int) throws {
        guard slides.indices.contains(from), slides.indices.contains(to) else { throw PresentationSessionError.invalidIndex }
        var next = slides; let slide = next.remove(at: from); next.insert(slide, at: to); commit(next)
    }
    public mutating func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(slides); slides = previous
    }
    public mutating func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(slides); slides = next
    }
}
