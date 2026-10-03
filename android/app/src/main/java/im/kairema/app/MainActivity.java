package im.kairema.app;

import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.IOException;

import im.kairema.app.loopback.DebugLog;
import im.kairema.app.loopback.DiagnosticsScreen;
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
 * recording is gated on {@code KAIREMA_ANDROID_DEBUG=1} and is inert in a release build.
 *
 * <p>The same debug builds carry a phone-only diagnostics screen for the terminal runtime, opened by
 * holding Volume Up and Volume Down together for a second and a half. It is reachable only when the
 * APK is debuggable <em>and</em> the build asked for diagnostics, it adds no control to the normal
 * interface, and it never consumes the volume keys: a release build has no gesture at all, so the
 * app renders exactly the Kairema frontend.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "KairemaMain";

    private LoopbackServer loopbackServer;
    private boolean diagnosticsEnabled;
    private TerminalSessions terminalSessions;

    /** Only ever armed in a debuggable build with diagnostics enabled. */
    private final DiagnosticsGesture diagnosticsGesture = new DiagnosticsGesture();
    private DiagnosticsScreen diagnosticsScreen;
    private Runnable pendingGestureCheck;

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
        cancelGestureCheck();
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

    // ---------------------------------------------------------------- phone-only diagnostics

    /**
     * Whether the diagnostics overlay may be opened at all.
     *
     * <p>Two independent conditions, both required. {@code KAIREMA_ANDROID_DEBUG=1} is a build-time
     * decision fixed in the generated Capacitor config, and {@code FLAG_DEBUGGABLE} comes from the
     * APK itself: a release build satisfies neither, so the gesture is not even armed there. There is
     * no asset, setting or intent that can switch this on from the device.
     */
    private boolean diagnosticsAvailable() {
        return diagnosticsEnabled && isDebuggable();
    }

    private boolean isDebuggable() {
        try {
            return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (RuntimeException unavailable) {
            // Default to closed: a diagnostics surface is never worth guessing at.
            return false;
        }
    }

    /**
     * Forwards the key to the platform, then feeds the gesture.
     *
     * <p>{@code super} is called first and its result is returned unchanged, so the volume keys keep
     * adjusting the volume and still raise the system OSD while the gesture is being watched. The
     * gesture observes; it never consumes. That is the whole reason it needs two keys held for a
     * second and a half instead of a plain tap.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        boolean handled = super.onKeyDown(keyCode, event);
        if (!diagnosticsAvailable()) {
            return handled;
        }
        long now = SystemClock.uptimeMillis();
        if (diagnosticsGesture.onDown(keyCode == KeyEvent.KEYCODE_VOLUME_UP,
                keyCode == KeyEvent.KEYCODE_VOLUME_DOWN, now)) {
            openDiagnostics();
            return handled;
        }
        scheduleGestureCheck(now);
        return handled;
    }

    /**
     * Forwards the key-up and lets the gesture know.
     *
     * <p>Once neither volume key is held, the gesture is reset so the next hold can fire again. The
     * reset is what stops a stale armed state from turning one later key press into a trigger.
     */
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        boolean handled = super.onKeyUp(keyCode, event);
        if (!diagnosticsAvailable()) {
            return handled;
        }
        diagnosticsGesture.onUp(keyCode == KeyEvent.KEYCODE_VOLUME_UP,
                keyCode == KeyEvent.KEYCODE_VOLUME_DOWN, SystemClock.uptimeMillis());
        if (!diagnosticsGesture.isArmed()) {
            cancelGestureCheck();
            diagnosticsGesture.reset();
        }
        return handled;
    }

    /**
     * Arms one check for the moment the hold completes.
     *
     * <p>Android only repeats a key-down while a key is held, and the repeat rate is not something to
     * depend on for timing. A single delayed runnable is posted for the remaining hold instead, so
     * the screen opens when the user finishes the gesture rather than whenever the next event
     * happens to arrive.
     */
    private void scheduleGestureCheck(long now) {
        if (pendingGestureCheck != null || !diagnosticsGesture.isArmed()
                || diagnosticsGesture.isTriggered()) {
            return;
        }
        pendingGestureCheck = () -> {
            pendingGestureCheck = null;
            if (diagnosticsAvailable() && diagnosticsGesture.poll(SystemClock.uptimeMillis())) {
                openDiagnostics();
            }
        };
        getWindow().getDecorView().postDelayed(pendingGestureCheck,
                Math.max(diagnosticsGesture.remainingMillis(now), 1L));
    }

    private void cancelGestureCheck() {
        if (pendingGestureCheck != null) {
            getWindow().getDecorView().removeCallbacks(pendingGestureCheck);
            pendingGestureCheck = null;
        }
    }

    /**
     * Raises the diagnostics overlay over the current content.
     *
     * <p>Added to {@code android.R.id.content} rather than replacing it, so the Capacitor layout and
     * the WebView stay attached underneath and the app is exactly as it was once the overlay is
     * dismissed. No button, menu entry or route leads here: the gesture is the only way in.
     */
    private void openDiagnostics() {
        ViewGroup container = findViewById(android.R.id.content);
        if (container == null || !diagnosticsAvailable()) {
            return;
        }
        if (diagnosticsScreen == null) {
            diagnosticsScreen = new DiagnosticsScreen(this,
                    "Terminal runtime diagnostics (debug build)", this::retryTerminalRuntime,
                    this::terminalStatus);
        }
        DebugLog.event("main activity: diagnostics screen opened");
        diagnosticsScreen.showIn(container);
    }

    /**
     * What the Retry button does.
     *
     * <p>Re-runs the same installation path startup uses and reloads the local origin. It reaches
     * nothing external: no URL is fetched from here and the upstream is not involved, so a retry can
     * never mask the failure it was meant to expose.
     */
    private void retryTerminalRuntime() {
        DebugLog.event("main activity: diagnostics retry requested");
        TerminalRuntime.get(this).ensureInstalled();
        if (loopbackServer != null && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().loadUrl(loopbackServer.getOrigin() + "/");
        }
    }

    /**
     * The runtime status shown above the log.
     *
     * <p>Called on the diagnostics screen's background thread, so the rootfs size walk is allowed
     * here and nowhere on the UI thread. Everything is derived from the runtime's own accessors and
     * from {@link File} checks under the runtime directory: booleans, counts and a byte total. No
     * path, digest, exception message or session id is included.
     */
    private String terminalStatus() {
        TerminalRuntime runtime = TerminalRuntime.get(this);
        File dir = runtime.getRuntimeDir();
        StringBuilder out = new StringBuilder();
        out.append("schema=").append(DebugLog.SCHEMA_VERSION).append('\n');
        out.append("debuggable=").append(isDebuggable()).append('\n');
        out.append("runtime.ready=").append(runtime.isReady()).append('\n');
        out.append("runtime.failureToken=").append(runtime.getFailureToken()).append('\n');
        out.append("runtime.markerPresent=").append(runtime.isInstallMarkerPresent()).append('\n');
        out.append("runtime.dirExists=").append(dir.isDirectory()).append('\n');
        File proot = new File(dir, "bin/proot");
        out.append("runtime.prootPresent=").append(proot.isFile()).append('\n');
        out.append("runtime.prootExecutable=").append(proot.canExecute()).append('\n');
        out.append("runtime.libtallocPresent=")
                .append(new File(dir, "lib/libtalloc.so.2").isFile()).append('\n');
        out.append("runtime.rootfsExists=").append(runtime.getRootfsDir().isDirectory())
                .append('\n');
        out.append("runtime.alpineReleasePresent=")
                .append(new File(runtime.getRootfsDir(), "etc/alpine-release").isFile()).append('\n');
        out.append("runtime.busyboxPresent=")
                .append(new File(runtime.getRootfsDir(), "bin/busybox").isFile()).append('\n');
        out.append("runtime.rootfsBytes=").append(runtime.getRootfsSizeBytes()).append('\n');
        out.append("loopback.port=")
                .append(loopbackServer == null ? "none" : loopbackServer.getPort()).append('\n');
        out.append("loopback.acceptLoopAlive=").append(loopbackServer != null
                && loopbackServer.isAcceptLoopAlive()).append('\n');
        out.append("sessions.live=")
                .append(terminalSessions == null ? 0 : terminalSessions.count())
                .append('/').append(TerminalSessions.MAX_SESSIONS).append('\n');
        return out.toString();
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
