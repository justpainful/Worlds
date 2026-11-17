#if DEBUG && WORLDS_MAIN_APP_MODULES && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
import SwiftUI
import WorldsMathDiagrams

/// Debug builds only, opened by the UI tests with `--ui-testing-user-reports`.
/// It shows the same views a page uses: the Mermaid block (concept map world and
/// diagram) and the drawing editor on a temporary synthetic database, so the
/// fixes users reported can be checked on iPhone, iPad and Mac simulators.
struct UserReportsCheckView: View {
    static let conceptMap = """
    flowchart TD
      C0(["Main idea"])
      C1["First concept"]
      C2["Second concept"]
      C3["Third concept"]
      C4["Result"]
      C0 -->|is made of| C1
      C0 -->|depends on| C2
      C1 -->|leads to| C3
      C2 -->|works with| C3
      C3 -->|produces| C4
    """

    @State private var part = 0
    @State private var drawing: URL?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Check", selection: $part) {
                    Text("Concept map").tag(0)
                    Text("Drawing").tag(1)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("user-reports-part")
                if part == 0 {
                    ScrollView { MermaidDiagramView(code: Self.conceptMap).padding(.vertical, 8) }
                } else if let drawing {
                    DrawingHarnessView(databaseURL: drawing, pageID: "fixture-drawing", actorID: "artist", fixtureMode: true,
                                       editsLocalCopy: true, validateIdentity: { true })
                } else {
                    Text(problem ?? "Preparing the drawing").accessibilityIdentifier("user-reports-problem")
                }
            }
            .padding(16)
            .navigationTitle("User reports")
        }
        .task {
            do { drawing = try LocalCopyUITestFixture.make().1 } catch { problem = "Drawing fixture failed: \(error)" }
        }
    }
}
#endif
