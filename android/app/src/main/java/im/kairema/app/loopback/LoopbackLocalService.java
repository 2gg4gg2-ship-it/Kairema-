package im.kairema.app.loopback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;

/**
 * A route served by the loopback origin itself rather than proxied upstream.
 *
 * <p>Everything here executes inside the app process: no request on a local route ever reaches the
 * upstream, and no upstream route is reachable through it. The local service is reached only after
 * {@link LoopbackHttpCore} has checked the {@code kairema_loopback} cookie, so a local route inherits
 * the same single credential as the proxy and no second secret mechanism exists.
 *
 * <p>Deliberately free of Android types so the transport keeps its existing shape and can still be
 * exercised on a plain JVM.
 *
 * <p>A handler writes the whole response itself, which is what lets a local route stream: it may
 * write a status line and headers, then keep writing and flushing body chunks for as long as the
 * stream is open. There is no separate "streaming" API because a buffered response is simply a
 * handler that returns.
 */
public interface LoopbackLocalService {

    /**
     * Whether this service owns the path.
     *
     * <p>Checked before authentication and before the proxy allowlist, so a local route can never be
     * shadowed by an upstream one, and an upstream route can never be hijacked into the local
     * handler. Matching is on the decoded path only.
     */
    boolean handles(String path);

    /**
     * Handles the request and writes the complete response to {@code out}.
     *
     * <p>Implementations must not close {@code out}; the transport owns the socket. A handler that
     * wants to stream should flush after each body chunk.
     *
     * @param method  request method, upper case
     * @param path    decoded path, already rejected for {@code ..} and NUL by the transport
     * @param query   raw query string, or null
     * @param headers request headers, keys lower-cased
     * @param body    request body, never null
     */
    void handle(String method, String path, String query, Map<String, String> headers, byte[] body,
            OutputStream out) throws IOException;
}
