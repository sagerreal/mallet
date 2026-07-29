import Capacitor

/// Bridges the web app's "Scan room" action to the native RoomPlan capture flow.
///
/// Registered as a plugin *instance* via `MalletViewController.capacitorDidLoad`
/// rather than through Capacitor's generated `packageClassList` — that manifest
/// is minted by `cap sync` from npm packages only, so a plugin that only exists
/// as a local .swift file (no npm package) never appears there.
@objc(RoomScanPlugin)
public class RoomScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomScanPlugin"
    public let jsName = "MalletRoomScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureRoom", returnType: CAPPluginReturnPromise)
    ]

    @objc public func available(_ call: CAPPluginCall) {
        // Placeholder — real LiDAR/iOS-17 device gating lands in Task 3.
        call.resolve(["available": true])
    }

    @objc public func captureRoom(_ call: CAPPluginCall) {
        call.reject("not implemented — Task 2")
    }
}
