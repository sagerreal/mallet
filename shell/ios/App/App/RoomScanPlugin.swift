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

    /// Serializes the single-active-scan guard below. Capacitor plugin methods can run on a
    /// background queue, so a naive Bool check-and-set from two near-simultaneous calls could
    /// both observe "not scanning" and both proceed to present a scan screen.
    private let stateQueue = DispatchQueue(label: "com.trymallet.app.RoomScanPlugin.state")
    private var isScanning = false

    @objc public func available(_ call: CAPPluginCall) {
        // Placeholder — real LiDAR/iOS-17 device gating lands in Task 3 (RoomCaptureSession.isSupported
        // must also gate captureRoom itself once that lands — tracked there, not duplicated here).
        call.resolve(["available": true])
    }

    /// Contract (mallet-app's `lib/native/room-scan.ts`): resolves
    /// `{ status: "done", rawPayload, geometry, capturedAt }` or `{ status: "cancelled" }`;
    /// rejects on hard errors (missing roomName, a scan already in progress, or an unrecoverable
    /// capture failure).
    @objc public func captureRoom(_ call: CAPPluginCall) {
        guard let roomName = call.getString("roomName")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !roomName.isEmpty else {
            call.reject("roomName is required to start a room scan")
            return
        }

        let alreadyScanning = stateQueue.sync { () -> Bool in
            if isScanning { return true }
            isScanning = true
            return false
        }
        guard !alreadyScanning else {
            call.reject("A room scan is already open.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let presenter = self.bridge?.viewController else {
                self.endScan()
                call.reject("No screen available to present the scan on")
                return
            }

            let scanVC = RoomScanViewController()
            scanVC.modalPresentationStyle = .fullScreen

            // One id/timestamp per capture, threaded to both the resolve payload and the
            // CaptureStore backup, so the two are correlatable from the same log line.
            let captureId = UUID()
            let capturedAtDate = Date()

            // Captured strongly (not `[weak self]`) — `self` is the long-lived plugin instance
            // (registered once for the app's lifetime), and a weak capture here risks the closure
            // silently no-op'ing if the plugin were ever deallocated mid-scan, which would leave
            // this call's promise hanging forever.
            scanVC.onFinished = { room in
                self.endScan()
                self.handleFinished(
                    room,
                    roomName: roomName,
                    id: captureId,
                    capturedAt: capturedAtDate,
                    call: call
                )
            }
            scanVC.onCancelled = {
                self.endScan()
                call.resolve(["status": "cancelled"])
            }
            scanVC.onFailed = { message in
                self.endScan()
                call.reject(message)
            }

            presenter.present(scanVC, animated: true)
        }
    }

    private func endScan() {
        stateQueue.sync { isScanning = false }
    }

    /// Runs the RoomPlan → geometry pipeline off the main queue, persists a native crash-safety
    /// backup, and resolves the JS contract shape.
    private func handleFinished(
        _ room: CapturedRoom,
        roomName: String,
        id: UUID,
        capturedAt: Date,
        call: CAPPluginCall
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let rawPayload = try RoomPlanExtractor.rawPayload(from: room)
                let surfaces = RoomPlanExtractor.surfaces(from: room)
                let geometry = try SurfaceMapper.geometry(from: surfaces)
                let geometryJSON = try geometry.encodeJSON()

                self.persistBackup(
                    id: id,
                    capturedAt: capturedAt,
                    rawPayload: rawPayload,
                    geometry: geometry,
                    roomName: roomName
                )

                guard let rawPayloadString = String(data: rawPayload, encoding: .utf8),
                      let geometryString = String(data: geometryJSON, encoding: .utf8) else {
                    DispatchQueue.main.async {
                        call.reject("Could not encode the scan result as text")
                    }
                    return
                }

                let capturedAtString = ISO8601DateFormatter().string(from: capturedAt)

                DispatchQueue.main.async {
                    call.resolve([
                        "status": "done",
                        "rawPayload": rawPayloadString,
                        "geometry": geometryString,
                        "capturedAt": capturedAtString
                    ])
                }
            } catch {
                let message = Self.processingErrorMessage(for: error)
                DispatchQueue.main.async {
                    call.reject(message)
                }
            }
        }
    }

    /// Native-side crash-safety backup, written BEFORE resolving to the web (the phone may lose
    /// the webview mid-return). This is a deliberate, scoped deviation from "never silently
    /// swallow errors": the web ingest call is the system of record, so a failure to write this
    /// local backup copy must not fail the `captureRoom()` call the tech is waiting on — it only
    /// means the crash-safety net for this one capture is missing, which is logged (with the
    /// capture id, so it's correlatable against the resolved payload), not silent.
    private func persistBackup(
        id: UUID,
        capturedAt: Date,
        rawPayload: Data,
        geometry: NormalizedGeometry,
        roomName: String
    ) {
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
                id: id,
                capturedAt: capturedAt,
                source: "roomplan_v1",
                roomName: roomName,
                payload: rawPayload,
                schemaVersion: 1
            )
            try store.save(capture, geometry: geometry)
            NSLog("RoomScanPlugin: persisted capture backup \(id) for room \"\(roomName)\"")
        } catch {
            NSLog("RoomScanPlugin: failed to persist native capture backup \(id): \(error)")
        }
    }

    /// Turns a scan-processing failure into functional, tech-facing copy — never the raw Swift
    /// error interpolated (a bare `MappingError.noFloor` means nothing to someone holding a
    /// phone).
    private static func processingErrorMessage(for error: Error) -> String {
        if let mappingError = error as? MappingError {
            switch mappingError {
            case .noFloor:
                return "The scan didn't capture a floor — walk the room's perimeter and scan again."
            case .noWalls:
                return "The scan didn't capture any walls — keep the walls in view and scan again."
            }
        }
        return "Could not process the scan. Try scanning the room again."
    }
}
