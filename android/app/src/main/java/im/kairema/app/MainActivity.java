package im.kairema.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.IOException;

import im.kairema.app.loopback.DebugLog;
import im.kairema.app.loopback.LoopbackServer;
import im.kairema.app.loopback.LoopbackServerFactory;
import im.kairema.app.terminal.TerminalRoutes;
import im.kairema.app.terminal.TerminalRuntime;
import im.kairema.app.terminal.TerminalSessions;

/**
 * Serves the bundled Kairema web app from an in-process loopback origin and points the WebView at it.
 *
 * Capacitor's own {@code server.url} is deliberately unused: the release shell must not depend on
 * Render to load its frontend, and loading from a remote URL would defeat signed OTA updates. The
 * bundled assets are served locally and only the API allowlist is forwarded upstream.
 *
 * <p>Debug builds still record the loopback origin's behaviour into {@link DebugLog}, because the
 * shell has so far failed on a real device and there is no PC, adb or logcat to inspect it with. That
 * recording is gated on {@code KAIREMA_ANDROID_DEBUG=1} and is inert in a release build. Nothing in it
 * is shown to the user: the diagnostics screen that used to be installed here is no longer reachable
 * from the interface, so the app renders exactly the Kairema frontend and nothing else.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "KairemaMain";

    private LoopbackServer loopbackServer;
    private boolean diagnosticsEnabled;
    private TerminalSessions terminalSessions;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        diagnosticsEnabled = LoopbackServerFactory.isDebugDiagnosticsEnabled(getAssets());
        if (diagnosticsEnabled) {
            DebugLog.init(this);
            DebugLog.event("MainActivity onCreate, schema " + DebugLog.SCHEMA_VERSION);
        }

        // Must run before super.onCreate: the Bridge loads its default asset origin inside its own
        // constructor, so the loopback listener has to exist before that happens.
        startLoopbackServer();
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        super.load();
        installDiagnosticWebViewClient();
        pointWebViewAtLoopback();
    }

    @Override
    public void onDestroy() {
        if (loopbackServer != null) {
            DebugLog.event("MainActivity onDestroy: stopping loopback server");
            loopbackServer.stop();
            loopbackServer = null;
        }
        // Stops every proot process. Without this a session would outlive the activity and leave an
        // orphan process holding the guest filesystem open.
        if (terminalSessions != null) {
            terminalSessions.shutdownAll();
            terminalSessions = null;
        }
        super.onDestroy();
    }

    private void startLoopbackServer() {
        DebugLog.event("about to create LoopbackServer");
        try {
            // The terminal runtime is installed lazily, off the startup path, so a slow first-run
            // extraction never delays the WebView. The routes report "unavailable" until it is done.
            terminalSessions = new TerminalSessions(this);
            loopbackServer = LoopbackServerFactory.create(getAssets(),
                    new TerminalRoutes(terminalSessions));
            TerminalRuntime.get(this).ensureInstalled();
            DebugLog.event("LoopbackServer created");
            loopbackServer.start();
            DebugLog.event("start() returned; port=" + loopbackServer.getPort()
                    + "; acceptLoopAlive=" + loopbackServer.isAcceptLoopAlive());
        } catch (IOException failure) {
            // The upstream host is intentionally never logged.
            loopbackServer = null;
            DebugLog.failure("LoopbackServer.create/start failed", failure);
            LoopbackServerFactory.logStartupFailure(failure);
        }
    }

    /**
     * Hands the per-launch credential to the WebView's cookie jar and then loads the loopback origin.
     *
     * <p>The credential is installed natively rather than injected into the page: the WebView then
     * presents it automatically on every same-origin request, including the XHR and SSE traffic the
     * web app creates on its own, with no change to any Kairema web code. Because the jar belongs to
     * this app, no other app on the device can read it, and {@code HttpOnly} keeps it away from
     * page scripts. The load is deferred until the cookie is committed so the very first request
     * already carries it.
     */
    private void pointWebViewAtLoopback() {
        if (loopbackServer == null || bridge == null) {
            DebugLog.event("not pointing WebView: server or bridge missing (server="
                    + (loopbackServer != null) + ", bridge=" + (bridge != null) + ")");
            return;
        }
        String origin = loopbackServer.getOrigin();
        if (origin.isEmpty()) {
            DebugLog.event("not pointing WebView: origin is empty");
            return;
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(origin, loopbackServer.getAccessCookie(), value -> {
            if (bridge != null && bridge.getWebView() != null) {
                // The origin is a 127.0.0.1 URL with an ephemeral port. It carries no credential:
                // the access secret lives only in the cookie jar and in the Cookie header.
                DebugLog.event("about to loadUrl " + origin);
                bridge.getWebView().loadUrl(origin + "/");
            }
        });
        Log.i(TAG, "WebView pointed at loopback origin on port " + loopbackServer.getPort());
    }

    /**
     * Wraps Capacitor's own {@link BridgeWebViewClient} so main-frame failures can be recorded.
     *
     * <p>Subclassing rather than replacing matters: every method not overridden here still runs
     * Capacitor's implementation, so plugin navigation and error handling are untouched. Only
     * main-frame callbacks are recorded, because a failed favicon or an aborted preconnect says
     * nothing about whether the loopback origin is reachable.
     */
    private void installDiagnosticWebViewClient() {
        if (!diagnosticsEnabled || bridge == null || bridge.getWebView() == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                DebugLog.event("main-frame navigation -> " + safeUrl(url));
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                DebugLog.event("WebView onPageFinished; sessionCookiePresent="
                        + hasSessionCookie());
                super.onPageFinished(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Whether Capacitor keeps this navigation or hands it to the system browser decides
                // where the session cookie ends up, so record which host was asked for. Only the host
                // is logged: query strings carry state, code and token.
                Uri uri = request.getUrl();
                String host = uri.getHost();
                DebugLog.event("navigation request host=" + (host == null ? "(none)" : host)
                        + " path=" + (uri.getPath() == null ? "/" : uri.getPath())
                        + "; isLoopback=" + isLoopbackHost(host));
                return super.shouldOverrideUrlLoading(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    // Recorded, not displayed: a failure here used to raise the diagnostics screen over
                    // the WebView. The screen is no longer installed, so the failure only ever lands in
                    // the debug log and the app renders exactly what it always did.
                    DebugLog.event("WebView main-frame ERROR code=" + error.getErrorCode()
                            + " desc=" + describe(error.getDescription()));
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                    WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) {
                    DebugLog.event("WebView main-frame HTTP ERROR status="
                            + errorResponse.getStatusCode());
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
        DebugLog.event("diagnostic WebViewClient installed");
    }

    private static String describe(CharSequence description) {
        return description == null ? "none" : description.toString();
    }

    /**
     * Host and path only.
     *
     * <p>Query strings are dropped on purpose: an OAuth landing carries {@code state}, {@code code}
     * and the session token, and none of that belongs in a file the user is asked to share. A path
     * alone is enough to tell which origin the app was on.
     */
    private static String safeUrl(String rawUrl) {
        if (rawUrl == null) {
            return "none";
        }
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            String path = uri.getPath();
            return (host == null ? "(no host)" : host) + (path == null || path.isEmpty() ? "/" : path);
        } catch (RuntimeException unparseable) {
            return "(unparseable url)";
        }
    }

    private static boolean isLoopbackHost(String host) {
        return "127.0.0.1".equals(host) || "localhost".equals(host);
    }

    /**
     * Whether any session cookie is present for the loopback origin, as a boolean.
     *
     * <p>The value is never read, logged or stored: the cookie jar is only asked whether it holds
     * anything, which is enough to tell "the callback never set a session" apart from "the session
     * exists but the frontend did not pick it up".
     */
    private boolean hasSessionCookie() {
        if (loopbackServer == null) {
            return false;
        }
        try {
            CookieManager cookies = CookieManager.getInstance();
            String header = cookies.getCookie(loopbackServer.getOrigin());
            if (header == null || header.isEmpty()) {
                return false;
            }
            for (String part : header.split(";")) {
                String name = part.trim();
                if (name.startsWith("app_session_id=") || name.startsWith("__Host-kairema-")) {
                    return true;
                }
            }
            return false;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }
}
