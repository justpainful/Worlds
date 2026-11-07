// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorldsCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WorldsModels", targets: ["WorldsModels"]),
        .library(name: "WorldsSyncWire", targets: ["WorldsSyncWire"]),
        .library(name: "WorldsPersistence", targets: ["WorldsPersistence"]),
        .library(name: "WorldsIdentity", targets: ["WorldsIdentity"]),
    ],
    targets: [
        .target(name: "WorldsModels"),
        .target(name: "WorldsSyncWire"),
        .target(name: "WorldsPersistence", exclude: ["README.md"], linkerSettings: [.linkedLibrary("sqlite3")]),
        .target(name: "WorldsIdentity", exclude: ["README.md"], linkerSettings: [.linkedFramework("Security")]),
        .testTarget(name: "WorldsModelsTests", dependencies: ["WorldsModels"]),
        .testTarget(name: "WorldsSyncWireTests", dependencies: ["WorldsSyncWire"]),
        .testTarget(name: "WorldsPersistenceTests", dependencies: ["WorldsPersistence"], resources: [.copy("worlds-v1-fixture.db")], linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "WorldsIdentityTests", dependencies: ["WorldsIdentity"]),
    ]
)
