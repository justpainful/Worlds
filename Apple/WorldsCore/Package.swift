// swift-tools-version: 6.0
import PackageDescription
import Foundation

let rustStorePath = "Artifacts/WorldsRustStore.xcframework"
let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let rustStoreAvailable = FileManager.default.fileExists(atPath: packageDirectory.appendingPathComponent(rustStorePath).path)

precondition(ProcessInfo.processInfo.environment["WORLDS_REQUIRE_NATIVE_WRITES"] != "1" || rustStoreAvailable, "WorldsRustStore.xcframework must be built before resolving this package")
let collaborationPath = "Artifacts/WorldsRustCollaboration.xcframework"
let collaborationAvailable = FileManager.default.fileExists(atPath: packageDirectory.appendingPathComponent(collaborationPath).path)
precondition(ProcessInfo.processInfo.environment["WORLDS_REQUIRE_COLLABORATION"] != "1" || collaborationAvailable, "WorldsRustCollaboration.xcframework must be built before resolving this package")

let package = Package(
    name: "WorldsCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WorldsModels", targets: ["WorldsModels"]),
        .library(name: "WorldsSyncWire", targets: ["WorldsSyncWire"]),
        .library(name: "WorldsPersistence", targets: ["WorldsPersistence"]),
        .library(name: "WorldsIdentity", targets: ["WorldsIdentity"]),
        .library(name: "WorldsRichText", targets: ["WorldsRichText"]),
        .library(name: "WorldsDrawing", targets: ["WorldsDrawing"]),
        .library(name: "WorldsPresentations", targets: ["WorldsPresentations"]),
        .library(name: "WorldsMedia", targets: ["WorldsMedia"]),
        .library(name: "WorldsSearch", targets: ["WorldsSearch"]),
        .library(name: "WorldsAI", targets: ["WorldsAI"]),
        .library(name: "WorldsNativeEditor", targets: ["WorldsNativeEditor"]),
        .library(name: "WorldsAutomations", targets: ["WorldsAutomations"]),
    ],
    targets: [
        .target(name: "WorldsModels"),
        .target(name: "WorldsSyncWire"),
        .target(name: "WorldsPersistence", exclude: ["README.md"], linkerSettings: [.linkedLibrary("sqlite3")]),
        .target(name: "WorldsIdentity", exclude: ["README.md"], linkerSettings: [.linkedFramework("Security")]),
        .target(name: "WorldsRichText", dependencies: ["WorldsModels"], exclude: ["README.md"]),
        .target(name: "WorldsDrawing", dependencies: ["WorldsModels"], exclude: ["README.md"]),
        .target(name: "WorldsPresentations", dependencies: ["WorldsModels"], exclude: ["README.md"]),
        .target(name: "WorldsMedia", exclude: ["README.md"]),
        .target(name: "WorldsSearch", exclude: ["README.md"], linkerSettings: [.linkedLibrary("sqlite3")]),
        .target(name: "WorldsAI", dependencies: ["WorldsModels"], exclude: ["README.md"]),
        .target(name: "WorldsNativeEditor", dependencies: ["WorldsModels", "WorldsRichText"], exclude: ["README.md"]),
        .target(name: "WorldsAutomations", dependencies: ["WorldsModels"], exclude: ["README.md"], linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "WorldsModelsTests", dependencies: ["WorldsModels"]),
        .testTarget(name: "WorldsSyncWireTests", dependencies: ["WorldsSyncWire"]),
        .testTarget(name: "WorldsPersistenceTests", dependencies: ["WorldsPersistence"], resources: [.copy("worlds-v1-fixture.db")], linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "WorldsIdentityTests", dependencies: ["WorldsIdentity"]),
        .testTarget(name: "WorldsRichTextTests", dependencies: ["WorldsRichText", "WorldsModels"]),
        .testTarget(name: "WorldsDrawingTests", dependencies: ["WorldsDrawing", "WorldsModels"]),
        .testTarget(name: "WorldsPresentationsTests", dependencies: ["WorldsPresentations", "WorldsModels"]),
        .testTarget(name: "WorldsMediaTests", dependencies: ["WorldsMedia"]),
        .testTarget(name: "WorldsSearchTests", dependencies: ["WorldsSearch"], resources: [.copy("worlds-v11.db")], linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "WorldsAITests", dependencies: ["WorldsAI", "WorldsModels"], resources: [.copy("Fixtures")]),
        .testTarget(name: "WorldsNativeEditorTests", dependencies: ["WorldsNativeEditor", "WorldsModels", "WorldsRichText"]),
        .testTarget(name: "WorldsAutomationsTests", dependencies: ["WorldsAutomations", "WorldsModels"], resources: [.copy("automation-fixture.db")], linkerSettings: [.linkedLibrary("sqlite3")]),
    ]
)

// The write bridge is present only after building the native XCFramework.
// Read-only clients continue to build before the optional binary exists.
if rustStoreAvailable {
    package.products.append(.library(name: "WorldsNativeWrites", targets: ["WorldsNativeWrites"]))
    package.targets.append(.binaryTarget(name: "WorldsRustStore", path: rustStorePath))
    package.targets.append(.target(name: "WorldsNativeWrites", dependencies: ["WorldsRustStore", "WorldsModels"], linkerSettings: [.linkedFramework("Security"), .linkedFramework("SystemConfiguration"), .linkedLibrary("resolv"), .linkedLibrary("iconv")]))
    package.targets.append(.testTarget(name: "WorldsNativeWritesTests", dependencies: ["WorldsNativeWrites", "WorldsModels", "WorldsRustStore"], resources: [.copy("worlds-v11.db")]))
}



// CI sets WORLDS_REQUIRE_COLLABORATION=1 so missing binaries fail package resolution.
// The application does not depend on this experimental module.
if collaborationAvailable {
    package.products.append(.library(name: "WorldsCollaboration", targets: ["WorldsCollaboration"]))
    package.targets.append(.binaryTarget(name: "WorldsRustCollaboration", path: collaborationPath))
    package.targets.append(.target(name: "WorldsCollaboration", dependencies: ["WorldsRustCollaboration", "WorldsSyncWire"], exclude: ["README.md"], linkerSettings: [.linkedFramework("Security"), .linkedFramework("SystemConfiguration"), .linkedLibrary("resolv"), .linkedLibrary("iconv")]))
    package.targets.append(.testTarget(name: "WorldsCollaborationTests", dependencies: ["WorldsCollaboration", "WorldsSyncWire"], resources: [.copy("worlds-collab-v11.db"), .copy("worlds-collab-editor-v11.db"), .copy("worlds-collab-viewer-v11.db")]))
}



