import Capacitor
import Foundation
import MalletCaptureCore
import MalletCaptureRoomPlan
import RoomPlan

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

    /// Contract (mallet-app's `lib/native/room-scan.ts`): resolves
    /// `{ status: "done", rawPayload, geometry, capturedAt }` or `{ status: "cancelled" }`;
    /// rejects on hard errors (missing roomName, unsupported device, unrecoverable capture
    /// failure).
    @objc public func captureRoom(_ call: CAPPluginCall) {
        guard let roomName = call.getString("roomName")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !roomName.isEmpty else {
            call.reject("roomName is required to start a room scan")
            return
        }

        guard #available(iOS 17.0, *) else {
            call.reject("Room scanning requires iOS 17 or later")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No screen available to present the scan on")
                return
            }

            let scanVC = RoomScanViewController()
            scanVC.modalPresentationStyle = .fullScreen

            scanVC.onFinished = { [weak self] room in
                self?.handleFinished(room, roomName: roomName, call: call)
            }
            scanVC.onCancelled = {
                call.resolve(["status": "cancelled"])
            }
            scanVC.onFailed = { message in
                call.reject(message)
            }

            presenter.present(scanVC, animated: true)
        }
    }

    /// Runs the RoomPlan → geometry pipeline off the main queue, persists a native crash-safety
    /// backup, and resolves the JS contract shape.
    @available(iOS 17.0, *)
    private func handleFinished(_ room: CapturedRoom, roomName: String, call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let rawPayload = try RoomPlanExtractor.rawPayload(from: room)
                let surfaces = RoomPlanExtractor.surfaces(from: room)
                let geometry = try SurfaceMapper.geometry(from: surfaces)
                let geometryJSON = try geometry.encodeJSON()

                self?.persistBackup(rawPayload: rawPayload, geometry: geometry, roomName: roomName)

                guard let rawPayloadString = String(data: rawPayload, encoding: .utf8),
                      let geometryString = String(data: geometryJSON, encoding: .utf8) else {
                    DispatchQueue.main.async {
                        call.reject("Could not encode the scan result as text")
                    }
                    return
                }

                let capturedAt = ISO8601DateFormatter().string(from: Date())

                DispatchQueue.main.async {
                    call.resolve([
                        "status": "done",
                        "rawPayload": rawPayloadString,
                        "geometry": geometryString,
                        "capturedAt": capturedAt
                    ])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Could not process the scan: \(error)")
                }
            }
        }
    }

    /// Native-side crash-safety backup, written BEFORE resolving to the web (the phone may lose
    /// the webview mid-return). This is a deliberate, scoped deviation from "never silently
    /// swallow errors": the web ingest call is the system of record, so a failure to write this
    /// local backup copy must not fail the `captureRoom()` call the tech is waiting on — it only
    /// means the crash-safety net for this one capture is missing, which is logged, not silent.
    @available(iOS 17.0, *)
    private func persistBackup(rawPayload: Data, geometry: NormalizedGeometry, roomName: String) {
        do {
            let appSupport = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let root = appSupport.appendingPathComponent("room-captures", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

            let store = CaptureStore(root: root)
            let capture = RawCapture(
                id: UUID(),
                capturedAt: Date(),
                source: "roomplan_v1",
                roomName: roomName,
                payload: rawPayload,
                schemaVersion: 1
            )
            try store.save(capture, geometry: geometry)
        } catch {
            NSLog("RoomScanPlugin: failed to persist native capture backup: \(error)")
        }
    }
}
