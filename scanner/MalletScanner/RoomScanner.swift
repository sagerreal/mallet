import Foundation
import RoomPlan
import SwiftUI
import UIKit

/// SwiftUI wrapper around RoomPlan's `RoomCaptureView`.
///
/// RoomPlan ships a complete UIKit scanning UI (the coaching overlay, the live wireframe, the
/// "Done" button) — we present it as-is rather than rebuilding it. The only thing we add is
/// grabbing the `CapturedRoom` when the scan finishes.
///
/// Requires: iOS 16+, and a device with a LiDAR sensor (iPhone 12 Pro and later Pro models, or a
/// LiDAR iPad Pro). `RoomCaptureSession.isSupported` is the runtime check — see ContentView.
struct RoomScanner: UIViewControllerRepresentable {
    /// Called once, when RoomPlan finishes processing the scan.
    let onFinished: (CapturedRoom) -> Void
    /// Called if the scan fails or the user cancels.
    let onFailed: (String) -> Void

    func makeUIViewController(context: Context) -> RoomScanViewController {
        let vc = RoomScanViewController()
        vc.onFinished = onFinished
        vc.onFailed = onFailed
        return vc
    }

    func updateUIViewController(_ uiViewController: RoomScanViewController, context: Context) {}
}

/// Hosts `RoomCaptureView` and drives its session lifecycle.
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    var onFinished: ((CapturedRoom) -> Void)?
    var onFailed: ((String) -> Void)?

    private var captureView: RoomCaptureView!
    private let config = RoomCaptureSessionConfig()
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
        if let error { report(failure: "Scan could not be processed: \(error.localizedDescription)") }
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error {
            report(failure: "Scan finished with an error: \(error.localizedDescription)")
            return
        }
        guard !didReport else { return }
        didReport = true
        onFinished?(processedResult)
    }

    // MARK: - RoomCaptureSessionDelegate

    /// The session's own end-of-run callback. Surfaces the documented failure cases — these are NOT
    /// edge cases for a contractor: `lowTexture` fires on a plain painted wall, `turnOnLight` on an
    /// unlit vacant unit, and `deviceTooHot` on a long scan.
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        guard let error else { return }
        report(failure: Self.describe(error))
    }

    private func report(failure message: String) {
        guard !didReport else { return }
        didReport = true
        onFailed?(message)
    }

    /// Turn RoomPlan's error enum into something a person on a job site can act on.
    static func describe(_ error: Error) -> String {
        guard let captureError = error as? RoomCaptureSession.CaptureError else {
            return error.localizedDescription
        }
        switch captureError {
        case .exceedSceneSizeLimit:
            return "This space is too large for one scan. Split it and scan in sections."
        case .deviceNotSupported:
            return "This device has no LiDAR sensor. RoomPlan needs an iPhone Pro or an iPad Pro."
        case .invalidARConfiguration:
            return "The camera session could not start. Close other camera apps and try again."
        case .worldTrackingFailure:
            return "Lost tracking. Move more slowly and keep walls and corners in view."
        case .internalError:
            return "RoomPlan hit an internal error. Try the scan again."
        @unknown default:
            return "Scan failed: \(error.localizedDescription)"
        }
    }
}
