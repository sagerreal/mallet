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
/// — this controller only drives the session and reports outcomes via its three closures. Every
/// exit path — Done, Cancel, a hard failure, or the screen simply disappearing for any other
/// reason — is guaranteed to call exactly one of those closures exactly once: the web promise this
/// eventually resolves/rejects must never be left hanging.
@available(iOS 17.0, *)
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    /// Called once, after the user taps Done and a `CapturedRoom` is available (either from
    /// RoomPlan's own post-processing, or built explicitly via `RoomBuilder` after a recoverable
    /// mid-scan error).
    var onFinished: ((CapturedRoom) -> Void)?
    /// Called when the user taps Cancel before a result is delivered, or as the last-resort net
    /// if this screen disappears without ever delivering an outcome.
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
    private let coachingLabel = PaddedLabel()

    /// Drives the Done/Cancel handshake against RoomPlan's async post-processing.
    /// - `.scanning`: the live state.
    /// - `.recoverableStopped`: RoomPlan itself ended the session for a coaching-mapped reason
    ///   (overheating, scene too large) — this is a UI state, not an auto-completion. The user
    ///   still has to explicitly choose Done (finish with what was captured) or Cancel.
    /// - `.finishing`: the user has committed to Done; Done/Cancel are disabled and we're only
    ///   waiting on a `CapturedRoom` — either from RoomPlan's own delegate, or (since RoomPlan's
    ///   behavior after a self-terminated session is undocumented) from an explicit `RoomBuilder`
    ///   pass over the retained `CapturedRoomData`.
    private enum Stage: Equatable {
        case scanning
        case recoverableStopped
        case finishing
    }
    private var stage: Stage = .scanning
    /// The processed room, if RoomPlan's delegate handed one back before the user tapped Done.
    private var pendingRoom: CapturedRoom?
    /// The raw capture data retained from a recoverable `didEndWith` error, so Done can build the
    /// room explicitly instead of betting on `RoomCaptureViewDelegate` firing after a
    /// self-terminated session.
    private var pendingData: CapturedRoomData?
    /// Guards against delivering a result twice — RoomPlan's delegates can each fire once for the
    /// same terminal event, and the last-resort net in `viewDidDisappear`/`deinit` must not
    /// re-fire after a normal delivery already happened.
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

    /// Belt-and-suspenders session stop on every exit path, mirroring the scanner reference —
    /// `deliver(_:)` already stops the session before dismissing, but this catches any path that
    /// removes this screen from the hierarchy without going through `deliver(_:)` first.
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureView.captureSession.stop(pauseARSession: true)
    }

    /// Settle-of-last-resort: if this screen has fully disappeared (dismissed or removed) without
    /// ever calling one of the three outcome closures, treat it as a cancel rather than leaving
    /// the web promise hanging forever. Deliberately permissive about *why* — every
    /// unknown-unknown here becomes a recoverable cancel, never a silent hang.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || isMovingFromParent {
            deliverCancelledIfUndelivered()
        }
    }

    deinit {
        deliverCancelledIfUndelivered()
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

        NSLayoutConstraint.activate([
            coachingLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            coachingLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            coachingLabel.bottomAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24
            ),
        ])
    }

    /// Updates the coaching label with a `CaptureCoaching` guidance string, or hides it for `nil`
    /// — called unconditionally from the live instruction stream so a resolved hint (e.g. the user
    /// turned the light back on) actually clears the label instead of leaving stale copy up.
    private func updateCoaching(_ coaching: CaptureCoaching?) {
        guard let coaching else {
            coachingLabel.isHidden = true
            return
        }
        coachingLabel.text = coaching.guidance
        coachingLabel.isHidden = false
    }

    /// Locks the UI once the user has committed to Done: RoomPlan's post-processing (or our own
    /// explicit `RoomBuilder` pass) takes a few seconds, and a Cancel tap in that window would
    /// silently discard an otherwise-complete scan.
    private func enterFinishing() {
        stage = .finishing
        cancelButton.isEnabled = false
        doneButton.isEnabled = false
        coachingLabel.text = "Finishing scan…"
        coachingLabel.isHidden = false
    }

    // MARK: - Actions

    @objc private func didTapCancel() {
        deliver(.cancelled)
    }

    @objc private func didTapDone() {
        switch stage {
        case .scanning:
            if let pendingRoom {
                deliver(.done(pendingRoom))
                return
            }
            enterFinishing()
            captureView.captureSession.stop(pauseARSession: true)
        case .recoverableStopped:
            if let pendingRoom {
                deliver(.done(pendingRoom))
                return
            }
            enterFinishing()
            if let pendingData {
                buildRoomManually(from: pendingData)
            }
            // If `pendingData` is somehow nil here there is nothing left to try — the delegate
            // callbacks below remain the only possible source of a result, and the
            // viewDidDisappear/deinit net still guarantees this never hangs.
        case .finishing:
            break
        }
    }

    /// Builds a `CapturedRoom` directly from retained `CapturedRoomData`, for the path where
    /// RoomPlan ended the session itself (overheating, scene too large) and its own
    /// `RoomCaptureViewDelegate` post-processing may never fire — never bet the web promise on an
    /// undocumented callback after a `CaptureError`.
    private func buildRoomManually(from data: CapturedRoomData) {
        Task { [weak self] in
            do {
                let room = try await RoomBuilder(options: []).capturedRoom(from: data)
                await MainActor.run {
                    self?.deliver(.done(room))
                }
            } catch {
                await MainActor.run {
                    self?.deliver(.error(Self.describe(error)))
                }
            }
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
            if stage == .scanning {
                stage = .recoverableStopped
            }
            updateCoaching(coaching)
        }

        if stage == .finishing {
            deliver(.done(processedResult))
        } else {
            pendingRoom = processedResult
        }
    }

    // MARK: - RoomCaptureSessionDelegate

    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        guard stage == .scanning else { return }
        updateCoaching(CaptureCoaching(instruction: instruction))
    }

    /// RoomPlan's own end-of-run callback. A coaching-mapped error (overheating, scene too large)
    /// means RoomPlan stopped the session itself — that's a UI state, not a failure: retain the
    /// raw `data` (post-processing after a self-terminated session is undocumented — Done builds
    /// the room explicitly rather than betting on it), show the guidance, and leave Done/Cancel
    /// live for the user to choose. Any other error is a hard, unrecoverable failure.
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        guard let error else { return }

        guard let captureError = error as? RoomCaptureSession.CaptureError,
              let coaching = CaptureCoaching(captureError: captureError) else {
            deliver(.error(Self.describe(error)))
            return
        }

        if stage == .scanning {
            stage = .recoverableStopped
            pendingData = data
        }
        updateCoaching(coaching)
    }

    // MARK: - Delivery

    private enum Outcome {
        case done(CapturedRoom)
        case cancelled
        case error(String)
    }

    /// Delivers exactly one outcome, exactly once. The closures are captured into a local `settle`
    /// value up front — NOT via `[weak self]` inside the `dismiss` completion — so that if this
    /// view controller is deallocated during the dismiss animation, the web promise this call
    /// eventually resolves/rejects still settles instead of silently dropping.
    private func deliver(_ outcome: Outcome) {
        guard !didDeliverResult else { return }
        didDeliverResult = true

        captureView?.captureSession.stop(pauseARSession: true)

        let onFinished = self.onFinished
        let onCancelled = self.onCancelled
        let onFailed = self.onFailed
        let settle: () -> Void = {
            switch outcome {
            case .done(let room):
                onFinished?(room)
            case .cancelled:
                onCancelled?()
            case .error(let message):
                onFailed?(message)
            }
        }

        if presentingViewController != nil {
            dismiss(animated: true, completion: settle)
        } else {
            settle()
        }
    }

    /// The last-resort net (`viewDidDisappear`/`deinit`): if nothing has delivered a result by the
    /// time this screen is gone, resolve as cancelled rather than hang the web promise forever.
    /// Deliberately does not call `dismiss` again — by the time this runs the screen is already
    /// disappearing or deallocating.
    private func deliverCancelledIfUndelivered() {
        guard !didDeliverResult else { return }
        didDeliverResult = true
        onCancelled?()
    }

    /// Turns an unrecoverable `RoomCaptureSession.CaptureError` (or a `RoomBuilder` failure) into
    /// user-facing copy. Coaching states are handled before this is ever reached — this is the one
    /// place hard-failure copy is authored, mirroring
    /// `scanner/MalletScanner/RoomScanner.swift`'s `describe(_:)`. Never interpolates the raw
    /// Swift error into copy shown to a tech.
    static func describe(_ error: Error) -> String {
        guard let captureError = error as? RoomCaptureSession.CaptureError else {
            return "The scan could not be finished. Try scanning the room again."
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
            return "The scan could not be finished. Try scanning the room again."
        @unknown default:
            return "The scan could not be finished. Try scanning the room again."
        }
    }
}

/// A `UILabel` with padded text — replaces manually padding the string with leading/trailing
/// spaces, which breaks for multi-line coaching copy and reads oddly to VoiceOver.
private final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(
            width: size.width + insets.left + insets.right,
            height: size.height + insets.top + insets.bottom
        )
    }
}
