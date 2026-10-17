package im.kairema.app.loopback;

import java.io.IOException;

/**
 * The loopback origin that serves the bundled Kairema web app inside the APK.
 *
 * The Android integration (MainActivity) depends only on this interface, so the HTTP transport
 * underneath it can be replaced later - for example by a Ktor CIO implementation - without touching
 * the WebView wiring or the Capacitor integration.
 */
public interface LoopbackServer {

    /**
     * Starts the server on an ephemeral loopback port. Must be called before {@link #getOrigin()}.
     *
     * @throws IOException if the upstream is not configured or the listener cannot bind.
     */
    void start() throws IOException;

    /** Stops the server and releases the port. Safe to call more than once. */
    void stop();

    /** The bound port, or -1 when the server is not running. */
    int getPort();

    /** The origin the WebView must be pointed at, for example {@code http://127.0.0.1:43593}. */
    String getOrigin();

    /**
     * The per-launch credential that authorises this origin, as a ready-to-use cookie string.
     *
     * <p>The WebView is given this once, natively, and the WebView then presents it automatically on
     * every same-origin request. It is generated with {@code SecureRandom} per launch, is never
     * persisted, never logged, and never placed in a URL.
     *
     * <p>A cookie is used rather than a header because the credential has to travel with requests the
     * web app makes on its own; injecting a header would mean rewriting the page and would put the
     * secret into the HTML that any process able to reach the loopback port could read. A cookie
     * lives in this app's WebView cookie jar, which no other app on the device can read, and with
     * {@code HttpOnly} the page's JavaScript cannot read it either.
     */
    String getAccessCookie();

    /**
     * Whether the accept loop is currently able to take connections.
     *
     * <p>A bound {@link ServerSocket} alone does not prove the origin is reachable: if the accept
     * loop has exited, the port still reports as valid while every connection is refused. This is
     * what lets the debug screen tell those two states apart.
     */
    boolean isAcceptLoopAlive();

    /** Whether the accept loop exited because of a failure rather than a normal {@link #stop()}. */
    boolean didAcceptLoopFail();

    /** Count of connections accepted so far. A counter only; no request content is retained. */
    int getAcceptedSocketCount();
}