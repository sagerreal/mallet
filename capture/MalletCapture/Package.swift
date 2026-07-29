// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MalletCapture",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MalletCaptureCore", targets: ["MalletCaptureCore"]),
        .library(name: "MalletCaptureRoomPlan", targets: ["MalletCaptureRoomPlan"]),
    ],
    targets: [
        .target(name: "MalletCaptureCore"),
        .target(
            name: "MalletCaptureRoomPlan",
            dependencies: ["MalletCaptureCore"]
        ),
        .testTarget(name: "MalletCaptureCoreTests", dependencies: ["MalletCaptureCore"]),
    ]
)
