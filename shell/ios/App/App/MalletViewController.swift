import Capacitor

/// Subclasses the generated bridge view controller so we can register plugins
/// that don't ship as npm packages (and therefore never appear in Capacitor's
/// generated `packageClassList`). Wired up in Main.storyboard via customClass.
class MalletViewController: CAPBridgeViewController {
    /// The app's paper background (matches capacitor.config.json ios.backgroundColor and the
    /// splash). Painted onto every layer BEHIND the webview — when the keyboard resizes the
    /// webview (Keyboard.resize = "native"), the window itself shows through the keyboard's
    /// transparent rounded corners, and an unpainted window is black.
    private static let paper = UIColor(red: 0xFC / 255.0, green: 0xFB / 255.0, blue: 0xF7 / 255.0, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomScanPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.paper
        webView?.backgroundColor = Self.paper
        webView?.scrollView.backgroundColor = Self.paper
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The window exists only once the view is in the hierarchy — paint it here.
        view.window?.backgroundColor = Self.paper
    }
}
