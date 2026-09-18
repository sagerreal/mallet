package com.trymallet.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

/**
 * The Mallet Android shell activity.
 *
 * Two things live here beyond the stock Capacitor BridgeActivity, both deliberate:
 *
 * 1. BACK BUTTON. Capacitor 8's BridgeActivity has NO back handling of its own —
 *    the stock behavior on Android is "system back finishes the activity", i.e. the
 *    app dies on the first back press no matter how deep into the web app you are.
 *    The usual fix (@capacitor/app's `backButton` JS listener) needs listener code
 *    in the web app, which lives in a separate repo and serves iOS/desktop too.
 *    Handling it natively keeps the whole behavior in this shell: back walks the
 *    WebView history (Next.js client-side navigations push real history entries,
 *    so this walks the SPA correctly), and at the history root it backgrounds the
 *    app (moveTaskToBack) instead of killing it — matching every native Android
 *    app's root-back behavior and keeping the WebView warm for the next open.
 *    Uses OnBackPressedDispatcher, the supported path under targetSdk 36's
 *    predictive-back regime (Activity#onBackPressed is no longer delivered there).
 *
 * 2. DEEP LINKS. The manifest declares Android App Links for /i/<token> and
 *    /q/<token> on app.trymallet.com (texted invoice / quote links). Capacitor's
 *    Bridge.onNewIntent only notifies plugins — without @capacitor/app plus a
 *    web-side `appUrlOpen` listener, a tapped link opens the app and then goes
 *    nowhere. So the routing is native too: if the intent carries a link on the
 *    configured server origin with an allowed path, load it in the WebView.
 *    Cold start is covered as well — BridgeActivity.load() replays the launch
 *    intent through onNewIntent, which virtual-dispatches into the override below.
 *
 *    The origin + path allow-list is a real gate, not ceremony: this activity is
 *    exported (launcher), so any app can throw an explicit VIEW intent at it with
 *    an arbitrary URI. Only https links on the configured server host with an
 *    allow-listed path prefix are ever loaded; everything else is ignored.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MalletMainActivity";

    /** Mirrors the manifest's App Link intent-filter — keep the two in sync. */
    private static final String[] DEEP_LINK_PATH_PREFIXES = { "/i/", "/q/" };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerBackHandler();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Lets the bridge notify plugins first (and handles the null-bridge guard).
        super.onNewIntent(intent);
        routeDeepLink(intent);
    }

    /**
     * Back = walk the WebView history; at the root, background the app instead of
     * finishing it. An always-enabled callback is the standard shape for WebView
     * apps: the branch decision (canGoBack) can only be made at press time.
     */
    private void registerBackHandler() {
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = bridge != null ? bridge.getWebView() : null;
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                }
            );
    }

    /**
     * Loads an allow-listed deep link into the WebView. Silently ignores anything
     * that is not an https link on the configured server origin with an allowed
     * path — a launcher intent, a foreign host, an unlisted path.
     */
    private void routeDeepLink(Intent intent) {
        if (bridge == null || intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }

        Uri link = intent.getData();
        if (link == null) {
            return;
        }

        String serverUrl = bridge.getServerUrl();
        if (serverUrl == null) {
            return;
        }

        Uri server = Uri.parse(serverUrl);
        boolean sameOrigin =
            "https".equals(link.getScheme()) && link.getHost() != null && link.getHost().equalsIgnoreCase(server.getHost());
        if (!sameOrigin) {
            Logger.debug(TAG, "Ignoring deep link off the server origin: " + link);
            return;
        }

        String path = link.getPath();
        if (path == null || !hasAllowedPathPrefix(path)) {
            Logger.debug(TAG, "Ignoring deep link with unlisted path: " + link);
            return;
        }

        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.loadUrl(link.toString());
        }
    }

    private boolean hasAllowedPathPrefix(String path) {
        for (String prefix : DEEP_LINK_PATH_PREFIXES) {
            if (path.startsWith(prefix) && path.length() > prefix.length()) {
                return true;
            }
        }
        return false;
    }
}
