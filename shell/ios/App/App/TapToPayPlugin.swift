import Capacitor
import Foundation
import ProximityReader
import StripeTerminal

/// Bridges the web app's Tap to Pay button to the Stripe Terminal SDK's local mobile reader —
/// the iPhone itself as the card reader.
///
/// Registered as a plugin *instance* via `MalletViewController.capacitorDidLoad`, the same way
/// `RoomScanPlugin` is and for the same reason: `cap sync` mints `packageClassList` from npm
/// packages only, so a plugin that exists solely as a local .swift file never appears there. A
/// build that forgets the registration probes as `plugin-missing` on the web side, which already
/// says "update the app" — a silent failure mode we get for free.
///
/// The web contract lives in `mallet-app/lib/native/tap-to-pay.ts`. Method names and payload keys
/// here must match it exactly.
///
/// APPLE REQUIREMENTS THIS FILE OWNS (Tap to Pay on iPhone App & Marketing Requirements v1.6):
///   1.4 — `PaymentCardReaderError.osVersionNotSupported` surfaces as an update-iOS message.
///   1.5 — the reader is warmed at launch and on foreground; without it 5.6's one-second budget
///         is unreachable, because a cold `connectReader` takes seconds.
///   1.6 — terms acceptance is read from the SDK on demand, never cached here or on the web side.
///   3.9 — configuration progress is forwarded as `readerUpdateProgress` events.
///   4.1 — `presentEducation()` shows Apple's own ProximityReaderDiscovery UI, which Apple says
///         fulfils 4.4 and 4.6 by itself.
@objc(TapToPayPlugin)
public class TapToPayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TapToPayPlugin"
    public let jsName = "MalletTapToPay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "termsAccepted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentEducation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "collectPayment", returnType: CAPPluginReturnPromise)
    ]

    /// Serialises the single-active-collection guard. Capacitor plugin methods can run off the
    /// main queue, so two near-simultaneous taps could both observe "idle" and both try to
    /// present a reader — the same hazard RoomScanPlugin guards.
    private let stateQueue = DispatchQueue(label: "com.trymallet.app.TapToPayPlugin.state")
    private var isCollecting = false
    private var isConnecting = false

    /// The connection-token provider Stripe calls whenever it needs a token. It cannot ask the
    /// web layer synchronously, so the bridge is an event out and a resolve back in — see
    /// `connectionTokenNeeded` below.
    private static let tokenProvider = WebConnectionTokenProvider()

    private static let unsupportedReason =
        "This iPhone can't take Tap to Pay — it needs a newer iPhone on a current iOS."

    // MARK: - Availability (1.1, 1.4)

    /// The DEVICE question only — hardware and OS support. Never permissions, never Stripe state.
    /// Identical division of labour to `MalletRoomScan.available()`.
    @objc public func available(_ call: CAPPluginCall) {
        guard Self.deviceSupported else {
            call.resolve(["available": false, "reason": Self.unsupportedReason])
            return
        }
        call.resolve(["available": true])
    }

    /// iPhone XS or newer on iOS 16.7+ (1.1). The SDK's own gate is authoritative; this reads it
    /// rather than hard-coding a device list, so a new iPhone needs no change here.
    private static var deviceSupported: Bool {
        // Result<(), Error>: .success means this hardware + OS can run the reader. Reading the
        // SDK's own gate rather than hard-coding a device list means a new iPhone needs no change.
        if case .success = Terminal.shared.supportsReaders(of: .tapToPay, discoveryMethod: .tapToPay, simulated: false) {
            return true
        }
        return false
    }

    // MARK: - Terms (1.6)

    /// Whether this merchant has accepted Apple's Terms & Conditions.
    ///
    /// Apple 1.6: *"retrieve it from Apple instead of storing it in a local variable in your
    /// app."* So this asks the SDK every time and caches nothing — a remembered yes survives the
    /// merchant revoking acceptance on another device, which would put a live reader in front of
    /// terms nobody currently accepts.
    @objc public func termsAccepted(_ call: CAPPluginCall) {
        guard Self.deviceSupported else {
            call.resolve(["accepted": false])
            return
        }
        // A connected local-mobile reader is the SDK's evidence that terms were accepted on this
        // device for this account: connection is what triggers the acceptance sheet.
        call.resolve(["accepted": Terminal.shared.connectedReader != nil])
    }

    // MARK: - Warm-up (1.5, 5.6)

    /// Discover and connect the on-device reader ahead of time.
    ///
    /// Apple 1.5 requires this at launch and on foreground, and 5.6 requires the Tap to Pay UI to
    /// appear within one second at least 90% of the time. Those are the same requirement seen from
    /// two ends: a cold `connectReader` performs discovery, account checks and possibly a reader
    /// software update, which is seconds, not milliseconds. Warming makes the tap instant.
    ///
    /// Idempotent and safe to call repeatedly — already-connected resolves immediately.
    @objc public func prepare(_ call: CAPPluginCall) {
        guard Self.deviceSupported else {
            call.resolve(["ready": false, "reason": Self.unsupportedReason])
            return
        }
        if Terminal.shared.connectedReader != nil {
            call.resolve(["ready": true])
            return
        }
        let already = stateQueue.sync { () -> Bool in
            if isConnecting { return true }
            isConnecting = true
            return false
        }
        if already {
            call.resolve(["ready": false, "reason": "already preparing"])
            return
        }

        guard let locationId = call.getString("locationId"), !locationId.isEmpty else {
            stateQueue.sync { isConnecting = false }
            call.reject("locationId is required to prepare the reader")
            return
        }

        connectLocalReader(locationId: locationId) { [weak self] result in
            self?.stateQueue.sync { self?.isConnecting = false }
            switch result {
            case .success:
                call.resolve(["ready": true])
            case .failure(let error):
                // A failed warm-up is NOT an error the user should see: the tap itself will
                // connect on demand and report anything real. Resolving keeps a background
                // prepare from surfacing noise at launch.
                call.resolve(["ready": false, "reason": Self.message(for: error)])
            }
        }
    }

    /// Discovery + connect for the local mobile reader, shared by `prepare` and `collectPayment`.
    private func connectLocalReader(
        locationId: String,
        completion: @escaping (Result<Reader, Error>) -> Void
    ) {
        let config = TapToPayDiscoveryConfigurationBuilder()
        do {
            let discoveryConfig = try config.build()
            var delivered = false
            _ = Terminal.shared.discoverReaders(discoveryConfig, delegate: DiscoveryForwarder { readers in
                guard !delivered, let reader = readers.first else { return }
                delivered = true
                do {
                    let connectionConfig = try TapToPayConnectionConfigurationBuilder(
                        delegate: ReaderConnectionForwarder(plugin: self),
                        locationId: locationId
                    ).build()
                    Terminal.shared.connectReader(reader, connectionConfig: connectionConfig) { connected, error in
                        if let connected { completion(.success(connected)) }
                        else { completion(.failure(error ?? TapToPayError.unknown)) }
                    }
                } catch {
                    completion(.failure(error))
                }
            }) { error in
                if let error, !delivered { completion(.failure(error)) }
            }
        } catch {
            completion(.failure(error))
        }
    }

    // MARK: - Education (4.1)

    /// Apple's own ProximityReaderDiscovery walkthrough — which Apple states fulfils requirements
    /// 4.4 and 4.6 on its own, and which stays current when Apple changes what the tap gesture
    /// looks like. Falls back to resolving `presented: false` on older iOS so the web layer can
    /// show its own screens (4.2's fallback path).
    @objc public func presentEducation(_ call: CAPPluginCall) {
        guard #available(iOS 18.0, *) else {
            call.resolve(["presented": false, "reason": "needs iOS 18"])
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.resolve(["presented": false, "reason": "no view controller to present from"])
                return
            }
            Task {
                do {
                    // "How to tap" is the content Apple ships for payment acceptance — the
                    // walkthrough 4.1 says fulfils 4.4 and 4.6 on its own.
                    let discovery = ProximityReaderDiscovery()
                    let content = try await discovery.content(for: .payment(.howToTap))
                    try await discovery.presentContent(content, from: presenter)
                    call.resolve(["presented": true])
                } catch {
                    call.resolve(["presented": false, "reason": error.localizedDescription])
                }
            }
        }
    }

    // MARK: - Collect (5.6–5.9)

    /// Take one payment. `clientSecret` is a card_present PaymentIntent minted server-side on the
    /// shop's connected account (`v1.terminal.createTapPaymentIntent`).
    ///
    /// Resolves `{ status: "succeeded", paymentIntentId }` — the web side then calls
    /// `v1.terminal.reconcileTapPayment`, which is what actually records the money. Cancellation
    /// resolves `{ status: "cancelled" }`; everything else rejects with a sentence the close-out
    /// can show (5.9).
    @objc public func collectPayment(_ call: CAPPluginCall) {
        guard Self.deviceSupported else {
            call.reject(Self.unsupportedReason)
            return
        }
        guard let clientSecret = call.getString("clientSecret"), !clientSecret.isEmpty else {
            call.reject("clientSecret is required to take a payment")
            return
        }
        guard let locationId = call.getString("locationId"), !locationId.isEmpty else {
            call.reject("locationId is required to take a payment")
            return
        }

        let busy = stateQueue.sync { () -> Bool in
            if isCollecting { return true }
            isCollecting = true
            return false
        }
        if busy {
            call.reject("A payment is already in progress on this phone.")
            return
        }
        let finish: (CAPPluginCall) -> Void = { [weak self] _ in
            self?.stateQueue.sync { self?.isCollecting = false }
        }

        let proceed = { [weak self] in
            guard let self else { return }
            Terminal.shared.retrievePaymentIntent(clientSecret: clientSecret) { intent, error in
                guard let intent else {
                    finish(call)
                    call.reject(Self.message(for: error ?? TapToPayError.unknown))
                    return
                }
                // 5.8 — the SDK's own UI shows "processing" between a successful read and the
                // confirm result; we forward nothing here because Apple owns those screens.
                _ = Terminal.shared.collectPaymentMethod(intent) { collected, collectError in
                    guard let collected else {
                        finish(call)
                        if let collectError, (collectError as NSError).code == ErrorCode.canceled.rawValue {
                            call.resolve(["status": "cancelled"])
                        } else {
                            call.reject(Self.message(for: collectError ?? TapToPayError.unknown))
                        }
                        return
                    }
                    Terminal.shared.confirmPaymentIntent(collected) { confirmed, confirmError in
                        finish(call)
                        guard let confirmed, confirmError == nil else {
                            call.reject(Self.message(for: confirmError ?? TapToPayError.unknown))
                            return
                        }
                        call.resolve([
                            "status": "succeeded",
                            "paymentIntentId": confirmed.stripeId ?? ""
                        ])
                    }
                }
            }
        }

        if Terminal.shared.connectedReader == nil {
            connectLocalReader(locationId: locationId) { result in
                switch result {
                case .success:
                    proceed()
                case .failure(let error):
                    finish(call)
                    call.reject(Self.message(for: error))
                }
            }
        } else {
            proceed()
        }
    }

    // MARK: - Errors (1.4)

    /// One place that turns an SDK error into a sentence a person at a customer's door can act on.
    ///
    /// 1.4 names the case that must not read as a generic failure: an iOS too old for the reader
    /// gets told to update, because that is a thing the merchant can actually fix.
    static func message(for error: Error) -> String {
        let ns = error as NSError
        // 1.4: the one problem the merchant can actually fix must not read as a generic failure.
        // The SDK reports an OS/hardware that cannot run the reader as
        // `unsupportedMobileDeviceConfiguration` (SCPError 2910).
        if ns.code == ErrorCode.unsupportedMobileDeviceConfiguration.rawValue {
            return "Update this iPhone to the latest iOS to use Tap to Pay."
        }
        if ns.code == ErrorCode.canceled.rawValue { return "Payment cancelled." }
        if ns.code == ErrorCode.declinedByStripeAPI.rawValue || ns.code == ErrorCode.declinedByReader.rawValue {
            return "The card was declined — try another card or take payment another way."
        }
        return ns.localizedDescription
    }

    enum TapToPayError: Error { case unknown }

    // MARK: - Bridged events

    /// Forwards the SDK's reader-update progress to the web layer (3.9) so the close-out can show
    /// a configuration progress indicator rather than an unexplained wait.
    func emitUpdateProgress(_ progress: Float) {
        notifyListeners("readerUpdateProgress", data: ["progress": progress])
    }

    /// Stripe needs a connection token and can only get one from our server. The plugin cannot
    /// call the web layer synchronously, so it emits and the web side answers by calling
    /// `provideConnectionToken` — the shape written down in the PR2 contract.
    func requestConnectionToken() {
        notifyListeners("connectionTokenNeeded", data: [:])
    }
}

// MARK: - SDK delegates

/// Adapts `discoverReaders`' delegate callback into a closure.
private final class DiscoveryForwarder: NSObject, DiscoveryDelegate {
    private let onReaders: ([Reader]) -> Void
    init(onReaders: @escaping ([Reader]) -> Void) { self.onReaders = onReaders }
    func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader]) {
        onReaders(readers)
    }
}

/// Forwards reader software-update progress so the plugin can emit 3.9's progress events.
private final class ReaderConnectionForwarder: NSObject, TapToPayReaderDelegate {
    private weak var plugin: TapToPayPlugin?
    init(plugin: TapToPayPlugin?) { self.plugin = plugin }

    func tapToPayReader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
        plugin?.emitUpdateProgress(0)
    }
    func tapToPayReader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float) {
        plugin?.emitUpdateProgress(progress)
    }
    func tapToPayReader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?) {
        plugin?.emitUpdateProgress(1)
    }
    func tapToPayReader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions) {}
    func tapToPayReader(_ reader: Reader, didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage) {}
    func reader(_ reader: Reader, didReportAvailableUpdate update: ReaderSoftwareUpdate) {}
    func reader(_ reader: Reader, didDisconnect reason: DisconnectReason) {}
}

/// Stripe's token provider. Every Terminal session needs a connection token minted by our server
/// on the shop's connected account; the plugin brokers that across the JS bridge.
private final class WebConnectionTokenProvider: NSObject, ConnectionTokenProvider {
    private var pending: ((String?, Error?) -> Void)?

    func fetchConnectionToken(_ completion: @escaping ConnectionTokenCompletionBlock) {
        pending = completion
        NotificationCenter.default.post(name: .malletTapToPayNeedsToken, object: nil)
    }

    /// Called when the web layer answers with a token from `v1.terminal.connectionToken`.
    func deliver(token: String) {
        pending?(token, nil)
        pending = nil
    }
}

extension Notification.Name {
    static let malletTapToPayNeedsToken = Notification.Name("MalletTapToPayNeedsToken")
}
