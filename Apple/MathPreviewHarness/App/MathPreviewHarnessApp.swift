import SwiftUI
import WorldsModels

@main struct MathPreviewHarnessApp: App {
    var body: some Scene { WindowGroup { MathFixtureView() } }
}
private struct MathFixtureView: View {
    @State private var node = try! MathSourceDocument(source: .object([
        "type": .string("mathBlock"), "attrs": .object(["latex": .string("x^2"), "bid": .string("fixture"), "future": .bool(true)])
    ]))
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Isolated math preview fixture").font(.headline)
                MathSourceEditor(node: $node)
                Text("Applied source: \(node.text)").accessibilityIdentifier("applied-math-source")
            }.padding()
        }.frame(minWidth: 300, minHeight: 400)
    }
}
