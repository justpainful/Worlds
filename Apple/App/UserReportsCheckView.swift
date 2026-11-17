#if WORLDS_UI_CHECKS && WORLDS_MAIN_APP_MODULES && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
import SwiftUI
import SQLite3
import WorldsMathDiagrams

/// Debug builds only (WORLDS_UI_CHECKS), opened by the UI tests with `--ui-testing-user-reports`.
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
            do { drawing = try Self.drawingFixture() } catch { problem = "Drawing fixture failed: \(error)" }
        }
    }

    /// A temporary copy of the bundled synthetic test database with one empty drawing page.
    /// The test database is only bundled in Debug builds; nothing here touches a user database.
    static func drawingFixture() throws -> URL {
        guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw CocoaError(.fileNoSuchFile) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let source = root.appendingPathComponent("user-reports.db")
        try FileManager.default.copyItem(at: fixture, to: source)
        var connection: OpaquePointer?
        guard sqlite3_open(source.path, &connection) == SQLITE_OK, let database = connection else {
            if let connection { sqlite3_close(connection) }
            throw CocoaError(.fileReadUnknown)
        }
        defer { sqlite3_close(database) }
        let sql = "INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('fixture-drawing','Fixture drawing','drawing','{}',1,100); INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);"
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        return source
    }
}
#endif
