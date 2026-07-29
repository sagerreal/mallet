import Capacitor

/// Subclasses the generated bridge view controller so we can register plugins
/// that don't ship as npm packages (and therefore never appear in Capacitor's
/// generated `packageClassList`). Wired up in Main.storyboard via customClass.
class MalletViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomScanPlugin())
    }
}
