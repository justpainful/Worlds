// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorldsCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WorldsModels", targets: ["WorldsModels"]),
        .library(name: "WorldsSyncWire", targets: ["WorldsSyncWire"]),
    ],
    targets: [
        .target(name: "WorldsModels"),
        .target(name: "WorldsSyncWire"),
        .testTarget(name: "WorldsModelsTests", dependencies: ["WorldsModels"]),
        .testTarget(name: "WorldsSyncWireTests", dependencies: ["WorldsSyncWire"]),
    ]
)
