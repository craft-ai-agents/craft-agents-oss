// apps/ios/CraftAgentKit/Package.swift
// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CraftAgentKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15), // enables `swift test` on macOS CI/dev machines without booting a simulator
    ],
    products: [
        .library(name: "CraftAgentKit", targets: ["CraftAgentKit"]),
    ],
    targets: [
        .target(name: "CraftAgentKit"),
        .testTarget(name: "CraftAgentKitTests", dependencies: ["CraftAgentKit"]),
    ]
)
