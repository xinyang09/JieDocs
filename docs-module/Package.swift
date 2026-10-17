// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DocsModule",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "DocsModule", targets: ["DocsModule"]),
    ],
    targets: [
        .target(name: "DocsModule", path: "Sources/DocsModule"),
    ]
)
