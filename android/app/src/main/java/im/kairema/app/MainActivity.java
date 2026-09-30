package im.kairema.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.IOException;

import im.kairema.app.loopback.DebugLog;
import im.kairema.app.loopback.DiagnosticsScreen;
import im.kairema.app.loopback.LoopbackServer;
import im.kairema.app.loopback.LoopbackServerFactory;

/**
 * Serves the bundled Kairema web app from an in-process loopback origin and points the WebView at it.
 *
 * Capacitor's own {@code server.url} is deliberately unused: the release shell must not depend on
 * Render to load its frontend, and loading from a remote URL would defeat signed OTA updates. The
 * bundled assets are served locally and only the API allowlist is forwarded upstream.
 *
 * <p>Debug builds additionally carry phone-readable diagnostics, because the loopback origin has so
 * far failed on a real device and the user has no PC, adb or logcat to inspect it with. Those paths
 * are gated on {@code KAIREMA_ANDROID_DEBUG=1} and are inert in a release build.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "KairemaMain";

    private LoopbackServer loopbackServer;
    private DiagnosticsScreen diagnosticsScreen;
    private View diagnosticsButton;
    private boolean diagnosticsEnabled;

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
        if (diagnosticsEnabled) {
            installDiagnosticsButton();
        }
        pointWebViewAtLoopback();
    }

    @Override
    public void onDestroy() {
        if (loopbackServer != null) {
            DebugLog.event("MainActivity onDestroy: stopping loopback server");
            loopbackServer.stop();
            loopbackServer = null;
        }
        super.onDestroy();
    }

    private void startLoopbackServer() {
        DebugLog.event("about to create LoopbackServer");
        try {
            loopbackServer = LoopbackServerFactory.create(getAssets());
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
                    DebugLog.event("WebView main-frame ERROR code=" + error.getErrorCode()
                            + " desc=" + describe(error.getDescription()));
                    showDiagnostics("WebView main-frame error code " + error.getErrorCode()
                            + " (" + error.getErrorCode() + " = " + describe(error.getDescription()) + ")");
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

    /**
     * Adds a permanent diagnostics button in debug builds.
     *
     * <p>The automatic screen only appears when the WebView reports a load error. An auth flow that
     * never navigates, or that silently hands the session to another app, produces no error at all -
     * which is exactly the case that has to be diagnosable, and the user has no adb to fall back on.
     */
    private void installDiagnosticsButton() {
        try {
            ViewGroup container = (ViewGroup) findViewById(android.R.id.content);
            if (container == null || diagnosticsButton != null) {
                return;
            }
            Button button = new Button(this);
            button.setText("Diag");
            button.setAllCaps(false);
            button.setTextSize(11);
            button.setOnClickListener(ignored -> showDiagnostics("opened manually"));
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
            params.gravity = Gravity.TOP | Gravity.END;
            params.topMargin = 48;
            params.rightMargin = 8;
            button.setLayoutParams(params);
            container.addView(button);
            diagnosticsButton = button;
            DebugLog.event("diagnostics button installed");
        } catch (RuntimeException failure) {
            DebugLog.failure("could not install diagnostics button", failure);
        }
    }

    /** Shows the native screen over the WebView, which is useless while it is the thing that failed. */
    private void showDiagnostics(String headline) {
        if (!diagnosticsEnabled) {
            return;
        }
        try {
            ViewGroup container = (ViewGroup) findViewById(android.R.id.content);
            if (container == null) {
                return;
            }
            if (diagnosticsScreen == null) {
                diagnosticsScreen = new DiagnosticsScreen(
                        this,
                        "Loopback WebView connection failed\n" + headline,
                        this::retryLoopback);
            } else {
                diagnosticsScreen.setHeadline("Loopback WebView connection failed\n" + headline);
            }
            diagnosticsScreen.showIn(container);
            DebugLog.event("diagnostics screen shown: " + headline);
        } catch (RuntimeException failure) {
            // Never let diagnostics crash the app.
            DebugLog.failure("could not show diagnostics screen", failure);
        }
    }

    /**
     * Restarts the loopback server and reloads it. The previous server is stopped first so a retry
     * cannot leave two listeners competing, and only a server that is genuinely accepting is loaded.
     */
    private void retryLoopback() {
        DebugLog.event("Retry requested");
        runOnUiThread(() -> {
            try {
                if (loopbackServer != null) {
                    loopbackServer.stop();
                    loopbackServer = null;
                }
                startLoopbackServer();
                if (diagnosticsScreen != null) {
                    diagnosticsScreen.hideFrom((ViewGroup) findViewById(android.R.id.content));
                }
                pointWebViewAtLoopback();
            } catch (RuntimeException failure) {
                DebugLog.failure("retry failed", failure);
            }
        });
    }
}
