import Foundation
import MalletCaptureCore
import MalletCaptureRoomPlan
import RoomPlan
import SwiftUI
import UIKit

/// SwiftUI wrapper around RoomPlan's `RoomCaptureView`.
///
/// RoomPlan ships a complete UIKit scanning UI (the coaching overlay, the live wireframe, the
/// "Done" button) — we present it as-is rather than rebuilding it. What we add: grabbing the
/// `CapturedRoom` when the scan finishes, and routing every piece of coaching/error copy through
/// `MalletCaptureCore.CaptureCoaching`, whose `guidance` strings are canonical — no copy is
/// authored locally here.
///
/// Requires: iOS 16+, and a device with a LiDAR sensor (iPhone 12 Pro and later Pro models, or a
/// LiDAR iPad Pro). `RoomCaptureSession.isSupported` is the runtime check — see ContentView.
struct RoomScanner: UIViewControllerRepresentable {
    /// Called once, when RoomPlan finishes processing the scan.
    let onFinished: (CapturedRoom) -> Void
    /// Called when a coaching state fires mid-scan (from either a live `Instruction` or a
    /// `CaptureError` RoomPlan treats as recoverable, e.g. overheating). Non-fatal — the scan
    /// keeps running.
    let onCoaching: (CaptureCoaching) -> Void
    /// Called if the scan fails outright (a `CaptureError` with no `CaptureCoaching` mapping) or
    /// the user cancels.
    let onFailed: (String) -> Void

    func makeUIViewController(context: Context) -> RoomScanViewController {
        let vc = RoomScanViewController()
        vc.onFinished = onFinished
        vc.onCoaching = onCoaching
        vc.onFailed = onFailed
        return vc
    }

    func updateUIViewController(_ uiViewController: RoomScanViewController, context: Context) {}
}

/// Hosts `RoomCaptureView` and drives its session lifecycle.
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    var onFinished: ((CapturedRoom) -> Void)?
    var onCoaching: ((CaptureCoaching) -> Void)?
    var onFailed: ((String) -> Void)?

    private var captureView: RoomCaptureView!
    private let config = RoomCaptureSession.Configuration()
    /// Guards against the delegate firing twice — RoomPlan can call back on cancel AND on error.
    private var didReport = false

    override func viewDidLoad() {
        super.viewDidLoad()

        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        captureView.captureSession.delegate = self
        view.addSubview(captureView)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: config)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // pauseARSession: true — this demo scans ONE room. Multi-room merging requires holding the
        // AR session open across rooms with `stop(pauseARSession: false)`, which is a later feature
        // and brings its own interruption-recovery problem (a phone call means the user has to walk
        // back to where they were interrupted).
        captureView.captureSession.stop(pauseARSession: true)
    }

    // MARK: - RoomCaptureViewDelegate

    /// Return true to let RoomPlan run its own post-processing and hand us a finished `CapturedRoom`.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { report(failure: Self.describe(error)) }
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error {
            report(failure: Self.describe(error))
            return
        }
        guard !didReport else { return }
        didReport = true
        onFinished?(processedResult)
    }

    // MARK: - RoomCaptureSessionDelegate

    /// Live coaching hints during the scan (blank wall, too dark, room too large, overheating).
    /// `CaptureCoaching(instruction:)` returns `nil` for transient motion hints (`.normal`,
    /// `.moveCloseToWall`, `.moveAwayFromWall`, `.slowDown`) that aren't user-facing coaching
    /// states — those are silently dropped rather than surfaced.
    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        guard let coaching = CaptureCoaching(instruction: instruction) else { return }
        onCoaching?(coaching)
    }

    /// The session's own end-of-run callback. Surfaces the documented failure cases — these are NOT
    /// edge cases for a contractor: `lowTexture` fires on a plain painted wall, `turnOnLight` on an
    /// unlit vacant unit, and overheating on a long scan.
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        guard let error else { return }
        report(failure: Self.describe(error))
    }

    private func report(failure message: String) {
        guard !didReport else { return }
        didReport = true
        onFailed?(message)
    }

    /// Turn RoomPlan's error enum into user-facing copy. `CaptureCoaching(captureError:)` is
    /// checked first — it covers `exceedSceneSizeLimit` (→ `.sceneTooLarge`) and `deviceTooHot`
    /// (→ `.deviceTooHot`; the SDK's own `CaptureError` carries a `deviceTooHot` case, so no
    /// separate `ProcessInfo.processInfo.thermalState` poll is needed to catch overheating).
    /// The remaining `CaptureError` cases (`deviceNotSupported`, `invalidARConfiguration`,
    /// `worldTrackingFailure`, `internalError`) are hard failures with no coaching equivalent —
    /// this is the one place their copy is authored, since `CaptureCoaching` deliberately has no
    /// case for "the scan cannot continue at all."
    static func describe(_ error: Error) -> String {
        guard let captureError = error as? RoomCaptureSession.CaptureError else {
            return error.localizedDescription
        }
        if let coaching = CaptureCoaching(captureError: captureError) {
            return coaching.guidance
        }
        switch captureError {
        case .deviceNotSupported:
            return "This device has no LiDAR sensor. RoomPlan needs an iPhone Pro or an iPad Pro."
        case .invalidARConfiguration:
            return "The camera session could not start. Close other camera apps and try again."
        case .worldTrackingFailure:
            return "Lost tracking. Move more slowly and keep walls and corners in view."
        case .internalError:
            return "RoomPlan hit an internal error. Try the scan again."
        case .exceedSceneSizeLimit, .deviceTooHot:
            // Unreachable: both are handled by CaptureCoaching above. Kept exhaustive so a future
            // SDK case triggers a compile error here, not a silent fallthrough.
            return error.localizedDescription
        @unknown default:
            return error.localizedDescription
        }
    }
}
