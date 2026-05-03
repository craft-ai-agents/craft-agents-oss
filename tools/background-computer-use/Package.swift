// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BackgroundComputerUse",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "BackgroundComputerUseKit", targets: ["BackgroundComputerUse"]),
        .executable(name: "BackgroundComputerUse", targets: ["BackgroundComputerUseServer"]),
    ],
    targets: [
        .target(
            name: "BackgroundComputerUse",
            path: "Sources/BackgroundComputerUse"
        ),
        .executableTarget(
            name: "BackgroundComputerUseServer",
            dependencies: ["BackgroundComputerUse"],
            path: "Sources/BackgroundComputerUseServer"
        ),
        .testTarget(
            name: "BackgroundComputerUseTests",
            dependencies: ["BackgroundComputerUse"],
            path: "Tests/BackgroundComputerUseTests"
        ),
    ]
)
