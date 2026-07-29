import MalletCaptureCore
import MalletCaptureRoomPlan
import RoomPlan
import UIKit

/// Full-screen modal that hosts RoomPlan's `RoomCaptureView` for the "Scan room" action.
///
/// Mirrors the scanner instrument's session lifecycle (`scanner/MalletScanner/RoomScanner.swift`)
/// but is presented by `RoomScanPlugin` as a plain UIKit view controller (Capacitor has no
/// SwiftUI host), and adds the app's own Cancel/Done chrome + coaching label on top of
/// `RoomCaptureView`'s built-in wireframe overlay.
///
/// All Apple-type interpretation happens downstream in `MalletCaptureRoomPlan`/`MalletCaptureCore`
/// — this controller only drives the session and reports outcomes via its three closures.
@available(iOS 17.0, *)
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    /// Called once, after the user taps Done and RoomPlan finishes post-processing.
    var onFinished: ((CapturedRoom) -> Void)?
    /// Called when the user taps Cancel before a result is delivered.
    var onCancelled: (() -> Void)?
    /// Called on a hard, unrecoverable failure (no coaching equivalent).
    var onFailed: ((String) -> Void)?

    /// The launch-cream background (#FCFBF7) used across the app's chrome — matches the value
    /// already baked into Main.storyboard's launch background color.
    private static let launchCream = UIColor(
        red: 0.988235294, green: 0.984313725, blue: 0.968627451, alpha: 1
    )

    private var captureView: RoomCaptureView!
    private let config = RoomCaptureSession.Configuration()

    private let topBar = UIView()
    private let cancelButton = UIButton(type: .system)
    private let doneButton = UIButton(type: .system)
    private let coachingLabel = UILabel()
    private var coachingBottomConstraint: NSLayoutConstraint!

    /// Drives the Done/Cancel handshake against RoomPlan's async post-processing. `.scanning` is
    /// the live state; `.recoverableStopped` is entered when RoomPlan itself ends the session for
    /// a coaching-mapped reason (overheating, scene too large) — the user still has to explicitly
    /// choose Done or Cancel from there, this is a UI state, not an auto-completion. `.finishing`
    /// means the user has committed to Done and we're only waiting on RoomPlan's delegate to hand
    /// back the processed `CapturedRoom`.
    private enum Stage: Equatable {
        case scanning
        case recoverableStopped
        case finishing
    }
    private var stage: Stage = .scanning
    /// The processed room, if RoomPlan finished post-processing before the user tapped Done
    /// (the `.recoverableStopped` path — the session already ended on its own).
    private var pendingRoom: CapturedRoom?
    /// Guards against delivering a result twice — RoomPlan's delegates can each fire once for
    /// the same terminal event.
    private var didDeliverResult = false

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.launchCream

        captureView = RoomCaptureView(frame: view.bounds)
        captureView.translatesAutoresizingMaskIntoConstraints = false
        captureView.delegate = self
        captureView.captureSession.delegate = self
        view.addSubview(captureView)

        setUpTopBar()
        setUpCoachingLabel()

        NSLayoutConstraint.activate([
            captureView.topAnchor.constraint(equalTo: view.topAnchor),
            captureView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            captureView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            captureView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: config)
    }

    // MARK: - Chrome

    private func setUpTopBar() {
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.backgroundColor = .clear
        view.addSubview(topBar)

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .regular)
        cancelButton.tintColor = .white
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.addTarget(self, action: #selector(didTapCancel), for: .touchUpInside)

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.tintColor = .white
        doneButton.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        doneButton.layer.cornerRadius = 8
        doneButton.contentEdgeInsets = UIEdgeInsets(top: 6, left: 16, bottom: 6, right: 16)
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        doneButton.addTarget(self, action: #selector(didTapDone), for: .touchUpInside)

        topBar.addSubview(cancelButton)
        topBar.addSubview(doneButton)

        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            topBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            topBar.heightAnchor.constraint(equalToConstant: 44),

            cancelButton.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            cancelButton.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),

            doneButton.trailingAnchor.constraint(equalTo: topBar.trailingAnchor),
            doneButton.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
        ])
    }

    private func setUpCoachingLabel() {
        coachingLabel.translatesAutoresizingMaskIntoConstraints = false
        coachingLabel.numberOfLines = 0
        coachingLabel.textAlignment = .center
        coachingLabel.textColor = .white
        coachingLabel.font = .systemFont(ofSize: 15, weight: .medium)
        coachingLabel.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        coachingLabel.layer.cornerRadius = 10
        coachingLabel.layer.masksToBounds = true
        coachingLabel.isHidden = true
        view.addSubview(coachingLabel)

        coachingBottomConstraint = coachingLabel.bottomAnchor.constraint(
            equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24
        )

        NSLayoutConstraint.activate([
            coachingLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            coachingLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            coachingBottomConstraint,
        ])
    }

    /// Updates the coaching label. `nil` hides it — a blank/dark/overheating/oversized-scene hint
    /// is only ever shown while it's actively true.
    private func updateCoaching(_ coaching: CaptureCoaching?) {
        guard let coaching else {
            coachingLabel.isHidden = true
            return
        }
        // Padding is baked into the label's own insets via attributed text below, but UILabel has
        // no built-in content insets — approximate with leading/trailing spaces would be a hack,
        // so instead grow via a container-less label and rely on layer.cornerRadius + generous
        // leading/trailing anchors already set for horizontal breathing room.
        coachingLabel.text = "  \(coaching.guidance)  "
        coachingLabel.isHidden = false
    }

    // MARK: - Actions

    @objc private func didTapCancel() {
        deliver(.cancelled)
    }

    @objc private func didTapDone() {
        switch stage {
        case .scanning:
            stage = .finishing
            updateCoaching(nil)
            captureView.captureSession.stop(pauseARSession: true)
        case .recoverableStopped:
            if let pendingRoom {
                deliver(.done(pendingRoom))
            } else {
                // RoomPlan hasn't finished post-processing yet — commit to finishing so the
                // delegate callback below delivers as soon as it arrives.
                stage = .finishing
            }
        case .finishing:
            break
        }
    }

    // MARK: - RoomCaptureViewDelegate

    /// Let RoomPlan run its own post-processing regardless of a recoverable error — the data
    /// captured up to that point is still a valid partial room, and the plan's contract is that
    /// deviceTooHot/exceedSceneSizeLimit are UI states the user finishes past, not aborts.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error {
            guard let captureError = error as? RoomCaptureSession.CaptureError,
                  let coaching = CaptureCoaching(captureError: captureError) else {
                deliver(.error(Self.describe(error)))
                return
            }
            updateCoaching(coaching)
        }

        switch stage {
        case .finishing:
            deliver(.done(processedResult))
        case .scanning, .recoverableStopped:
            pendingRoom = processedResult
        }
    }

    // MARK: - RoomCaptureSessionDelegate

    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        guard stage == .scanning, let coaching = CaptureCoaching(instruction: instruction) else { return }
        updateCoaching(coaching)
    }

    /// RoomPlan's own end-of-run callback. A coaching-mapped error (overheating, scene too large)
    /// means RoomPlan stopped the session itself — that's a UI state, not a failure: show the
    /// guidance and leave Done/Cancel live for the user to choose. Any other error is a hard,
    /// unrecoverable failure.
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        guard let error else { return }

        guard let captureError = error as? RoomCaptureSession.CaptureError,
              let coaching = CaptureCoaching(captureError: captureError) else {
            deliver(.error(Self.describe(error)))
            return
        }

        if stage == .scanning {
            stage = .recoverableStopped
        }
        updateCoaching(coaching)
    }

    // MARK: - Delivery

    private enum Outcome {
        case done(CapturedRoom)
        case cancelled
        case error(String)
    }

    private func deliver(_ outcome: Outcome) {
        guard !didDeliverResult else { return }
        didDeliverResult = true

        captureView.captureSession.stop(pauseARSession: true)

        dismiss(animated: true) { [weak self] in
            guard let self else { return }
            switch outcome {
            case .done(let room):
                self.onFinished?(room)
            case .cancelled:
                self.onCancelled?()
            case .error(let message):
                self.onFailed?(message)
            }
        }
    }

    /// Turns an unrecoverable `RoomCaptureSession.CaptureError` into user-facing copy. Coaching
    /// states are handled before this is ever reached — this is the one place hard-failure copy
    /// is authored, mirroring `scanner/MalletScanner/RoomScanner.swift`'s `describe(_:)`.
    static func describe(_ error: Error) -> String {
        guard let captureError = error as? RoomCaptureSession.CaptureError else {
            return error.localizedDescription
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
            // Unreachable: both are coaching-mapped and handled before this is called. Kept
            // exhaustive so a future SDK case triggers a compile error here, not a silent
            // fallthrough.
            return error.localizedDescription
        @unknown default:
            return error.localizedDescription
        }
    }
}
