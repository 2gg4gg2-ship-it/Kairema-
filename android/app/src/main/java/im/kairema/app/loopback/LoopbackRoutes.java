package im.kairema.app.loopback;

import java.util.List;

/**
 * The complete set of server routes the Android shell is allowed to reach through the loopback proxy.
 *
 * Every entry maps to a route that exists in {@code server/_core/index.ts}. Routes that exist only
 * for operator use - {@code /api/dev}, {@code /api/diagnostic/*} and {@code /api/scheduled/*} - are
 * deliberately absent, so a request for them is served from the bundled assets (and 404s) instead of
 * being forwarded. The proxy is never asked to decide based on a client-supplied upstream.
 */
public final class LoopbackRoutes {

    /** tRPC: every mutation and query, including BYOK-free account data. */
    public static final String TRPC = "/api/trpc";

    /** Server-sent event chat stream. Must never be buffered. */
    public static final String CHAT_STREAM = "/api/chat/stream";

    /** Attachment uploads; bodies are large and may arrive chunked. */
    public static final String ATTACHMENTS_UPLOAD = "/api/attachments/upload";

    /** OAuth redirect landing. Reached as a top-level navigation after the provider redirect. */
    public static final String OAUTH_CALLBACK = "/api/oauth/callback";

    /** Stytch redirect landing, when Stytch auth is enabled. */
    public static final String STYTCH_CALLBACK = "/api/stytch/callback";

    /**
     * Attachment/font storage. On the server this is a 307 redirect to a B2 signed URL, which the
     * proxy follows server-side so the signed URL never reaches the WebView.
     */
    public static final String STORAGE = "/manus-storage/";

    /** Exactly the allowlist above, in match order. */
    public static final List<String> PROXY_ALLOWLIST = List.of(
            TRPC, CHAT_STREAM, ATTACHMENTS_UPLOAD, OAUTH_CALLBACK, STYTCH_CALLBACK, STORAGE);

    /**
     * Root of the on-device terminal API.
     *
     * <p>These routes are served inside the app process and are deliberately absent from
     * {@link #PROXY_ALLOWLIST}: the backend has no terminal, and a request that reached it would be
     * answered by the wrong server. They share the {@code /api/local/} prefix rather than
     * {@code /api/*} so no future upstream route can be swallowed by the local handler, and the
     * allowlist stays exactly the six entries above.
     */
    public static final String LOCAL_TERMINAL = "/api/local/terminal";

    /**
     * Local route prefixes, for logging only. Ownership is decided by the local service itself, not
     * by this list, so adding a route cannot silently widen what is forwarded upstream.
     */
    public static final List<String> LOCAL_PREFIXES = List.of(LOCAL_TERMINAL);

    private LoopbackRoutes() {
    }

    /**
     * True when the path may be forwarded upstream.
     *
     * Matching is prefix-based on a segment boundary, so {@code /api/trpc-evil} does not match
     * {@code /api/trpc} while {@code /api/trpc/batch/1} and {@code /manus-storage/key} do.
     */
    public static boolean isProxyable(String path) {
        for (String prefix : PROXY_ALLOWLIST) {
            if (prefix.endsWith("/")) {
                if (path.startsWith(prefix)) {
                    return true;
                }
            } else if (path.equals(prefix) || path.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    /**
     * True when a path under the local terminal prefix could be mistaken for an upstream route.
     *
     * <p>Exists so the separation is asserted rather than assumed: no local prefix may overlap
     * {@link #PROXY_ALLOWLIST}, in either direction.
     */
    public static boolean localPrefixesOverlapProxyAllowlist() {
        for (String local : LOCAL_PREFIXES) {
            for (String remote : PROXY_ALLOWLIST) {
                String localBase = local.endsWith("/") ? local : local + "/";
                String remoteBase = remote.endsWith("/") ? remote : remote + "/";
                if (localBase.startsWith(remoteBase) || remoteBase.startsWith(localBase)) {
                    return true;
                }
            }
        }
        return false;
    }
}