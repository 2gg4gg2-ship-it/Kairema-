package im.kairema.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

import java.io.IOException;

import im.kairema.app.loopback.LoopbackServer;
import im.kairema.app.loopback.LoopbackServerFactory;

/**
 * Serves the bundled Kairema web app from an in-process loopback origin and points the WebView at it.
 *
 * Capacitor's own {@code server.url} is deliberately unused: the release shell must not depend on
 * Render to load its frontend, and loading from a remote URL would defeat signed OTA updates. The
 * bundled assets are served locally and only the API allowlist is forwarded upstream.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "KairemaMain";

    private LoopbackServer loopbackServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate: the Bridge loads its default asset origin inside its own
        // constructor, so the loopback listener has to exist before that happens.
        startLoopbackServer();
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        super.load();
        pointWebViewAtLoopback();
    }

    @Override
    protected void onDestroy() {
        if (loopbackServer != null) {
            loopbackServer.stop();
            loopbackServer = null;
        }
        super.onDestroy();
    }

    private void startLoopbackServer() {
        try {
            loopbackServer = LoopbackServerFactory.create(getAssets());
            loopbackServer.start();
        } catch (IOException failure) {
            // The upstream host is intentionally never logged.
            loopbackServer = null;
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
            return;
        }
        String origin = loopbackServer.getOrigin();
        if (origin.isEmpty()) {
            return;
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(origin, loopbackServer.getAccessCookie(), value -> {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().loadUrl(origin + "/");
            }
        });
        Log.i(TAG, "WebView pointed at loopback origin on port " + loopbackServer.getPort());
    }
}