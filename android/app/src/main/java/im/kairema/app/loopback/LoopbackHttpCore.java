package im.kairema.app.loopback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Temporary HTTP transport for the loopback origin.
 *
 * <p>Proven end to end by the transport spike: static serving, POST body integrity, chunked request
 * bodies, incremental SSE, multi {@code Set-Cookie} passthrough and the security boundaries. It is
 * isolated here, free of any Android type, so it runs unchanged both inside the APK and on a plain
 * JVM where the spike drives it. It can later be replaced by a Ktor CIO implementation of
 * {@link LoopbackServer} without touching the WebView wiring.
 *
 * <p>Scope is fixed and narrow: it serves the bundled web files and forwards only
 * {@link LoopbackRoutes#PROXY_ALLOWLIST} to one upstream supplied at construction, which is never
 * read from a request.
 */
public final class LoopbackHttpCore implements LoopbackServer {

    /** Cookie the WebView presents to prove it is this app's own WebView. */
    static final String ACCESS_COOKIE_NAME = "kairema_loopback";

    /** Headers that must never be copied across a proxy hop. */
    private static final List<String> HOP_BY_HOP = List.of(
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
            "accept-encoding");

    /** HttpURLConnection mangles header casing ("Set-cookie"); these are restored to canonical form. */
    private static final Map<String, String> CANONICAL_HEADERS = Map.of(
            "set-cookie", "Set-Cookie",
            "content-type", "Content-Type",
            "content-length", "Content-Length",
            "cache-control", "Cache-Control",
            "location", "Location",
            "etag", "ETag",
            "content-disposition", "Content-Disposition");

    private static final int MAX_BODY_BYTES = 64 * 1024 * 1024;

    /**
     * The loopback origin is always IPv4, so it is bound as IPv4. {@link InetAddress#getLoopbackAddress()}
     * may hand back {@code ::1} when IPv6 is preferred, and the WebView is always pointed at
     * {@code http://127.0.0.1:<port>}: a socket listening on the IPv6 loopback would leave nothing on
     * the IPv4 address, which surfaces in the WebView as {@code ERR_CONNECTION_REFUSED} even though
     * {@link #getPort()} reports a perfectly valid port.
     *
     * <p>Resolved lazily because {@code getByName} declares a checked exception, which a static
     * field initialiser cannot propagate.
     */
    private static InetAddress loopbackV4() throws IOException {
        // UnknownHostException is an IOException, so a numeric literal cannot fail in practice.
        return InetAddress.getByName("127.0.0.1");
    }

    private final LoopbackStaticSource staticSource;
    private final URL upstream;
    private final LoopbackLog log;
    private final LoopbackLocalService localService;

    private String accessSecret;
    private ServerSocket serverSocket;
    private ExecutorService workers;
    private volatile boolean acceptLoopAlive;
    private volatile boolean acceptLoopFailed;
    private final java.util.concurrent.atomic.AtomicInteger acceptedSockets =
            new java.util.concurrent.atomic.AtomicInteger();

    /**
     * Monotonic counter behind the per-request correlation id.
     *
     * <p>Diagnostic only. The id is what lets a reader follow one WebView request across five
     * log lines that are written from different phases, including an "upstream failed" line that is
     * written by a different stack frame than the line that started the request. It is deliberately
     * short and sequential: it carries no secret, it survives redaction unchanged, and its ordering
     * is itself useful evidence of how many requests the WebView made.
     */
    private static final java.util.concurrent.atomic.AtomicLong REQUEST_SEQUENCE =
            new java.util.concurrent.atomic.AtomicLong();

    private static String newCorrelationId() {
        return "d" + Long.toHexString(REQUEST_SEQUENCE.incrementAndGet());
    }

    /** Milliseconds since {@code startedAtNanos}, never negative and never a wall-clock reading. */
    private static long elapsedMs(long startedAtNanos) {
        return Math.max(0L, (System.nanoTime() - startedAtNanos) / 1_000_000L);
    }

    public LoopbackHttpCore(LoopbackStaticSource staticSource, URL upstream) {
        this(staticSource, upstream, LoopbackLog.NO_OP, null);
    }

    public LoopbackHttpCore(LoopbackStaticSource staticSource, URL upstream, LoopbackLog log) {
        this(staticSource, upstream, log, null);
    }

    public LoopbackHttpCore(LoopbackStaticSource staticSource, URL upstream, LoopbackLog log,
            LoopbackLocalService localService) {
        this.staticSource = staticSource;
        this.upstream = upstream;
        this.log = log;
        this.localService = localService;
    }

    @Override
    public synchronized void start() throws IOException {
        accessSecret = newAccessSecret();
        // Loopback only, ephemeral port. There is deliberately no way to bind 0.0.0.0 or a fixed port.
        serverSocket = new ServerSocket(0, 64, loopbackV4());
        workers = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "kairema-loopback");
            t.setDaemon(true);
            return t;
        });
        Thread accept = new Thread(this::acceptLoop, "kairema-loopback-accept");
        accept.setDaemon(true);
        acceptLoopAlive = true;
        acceptLoopFailed = false;
        acceptedSockets.set(0);
        accept.start();
        log.info("Loopback listener bound to 127.0.0.1:" + getPort() + "; accept loop started");
    }

    @Override
    public synchronized void stop() {
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // Listener already gone.
            }
            serverSocket = null;
            log.info("Loopback listener stopped");
        }
        if (workers != null) {
            workers.shutdownNow();
            workers = null;
        }
        accessSecret = null;
    }

    @Override
    public int getPort() {
        return serverSocket == null ? -1 : serverSocket.getLocalPort();
    }

    @Override
    public String getOrigin() {
        int port = getPort();
        return port < 0 ? "" : "http://127.0.0.1:" + port;
    }

    @Override
    public String getAccessCookie() {
        return ACCESS_COOKIE_NAME + "=" + accessSecret + "; Path=/; HttpOnly";
    }

    @Override
    public boolean isAcceptLoopAlive() {
        return acceptLoopAlive && serverSocket != null && !serverSocket.isClosed();
    }

    @Override
    public boolean didAcceptLoopFail() {
        return acceptLoopFailed;
    }

    @Override
    public int getAcceptedSocketCount() {
        return acceptedSockets.get();
    }

    private static String newAccessSecret() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    // ---------------------------------------------------------------- listener

    private void acceptLoop() {
        while (serverSocket != null && !serverSocket.isClosed()) {
            Socket socket;
            try {
                socket = serverSocket.accept();
            } catch (IOException e) {
                // stop() closes the socket, which is the normal way out of this loop. Anything else
                // means the listener died while still advertising a port, so it is logged rather
                // than swallowed: the WebView would otherwise be pointed at a dead origin and fail
                // with ERR_CONNECTION_REFUSED with nothing in logcat to explain it.
                if (serverSocket != null && !serverSocket.isClosed()) {
                    acceptLoopFailed = true;
                    log.warn("Loopback accept loop stopped unexpectedly: "
                            + e.getClass().getSimpleName(), e);
                } else {
                    log.info("Loopback accept loop exited after the listener was closed");
                }
                acceptLoopAlive = false;
                return;
            }
            acceptLoopAlive = true;
            ExecutorService pool = workers;
            if (pool == null) {
                closeQuietly(socket);
                return;
            }
            try {
                pool.execute(() -> handleQuietly(socket));
                acceptedSockets.incrementAndGet();
            } catch (RuntimeException rejected) {
                closeQuietly(socket);
            }
        }
        acceptLoopAlive = false;
    }

    private void handleQuietly(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            // Taken as close to the accept as the task start allows, so the time the WebView spent
            // getting its request line and headers onto this socket is separable from everything
            // that happens after.
            handle(socket, System.nanoTime());
        } catch (IOException ignored) {
            // A dropped client must not take the listener down.
        } finally {
            closeQuietly(socket);
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // Nothing useful to do while tearing down.
        }
    }

    // ---------------------------------------------------------------- request

    private static final class Request {
        String method = "";
        String path = "";
        String query;
        /** Diagnostic correlation id, never part of the forwarded request. */
        String correlationId = "";
        final Map<String, String> headers = new LinkedHashMap<>();
        byte[] body = new byte[0];
    }

    private void handle(Socket socket, long acceptedAtNanos) throws IOException {
        InputStream in = socket.getInputStream();
        OutputStream out = socket.getOutputStream();

        Request request = readRequest(in);
        if (request == null) {
            writeSimple(out, 400, "malformed or disallowed request");
            return;
        }
        // readMs is the WebView-to-loopback leg on its own. It is the one number that separates "the
        // page never got its request out" from "the request arrived and the answer was slow".
        log.info("diag request accepted; corr=" + request.correlationId + "; method=" + request.method
                + "; route=" + routeLabelForDiagnostics(request)
                + "; bodyBytes=" + request.body.length
                + "; readMs=" + elapsedMs(acceptedAtNanos));
        if (localService != null && localService.handles(request.path)) {
            // Local routes run in this process and are never forwarded upstream. They are checked
            // against the same cookie as the proxy, so there is still exactly one credential: the
            // session id in the path is a lookup key, not authorisation.
            if (!isAuthorised(request)) {
                writeSimple(out, 403, "loopback access denied");
                return;
            }
            log.info("local request " + request.method + " " + safeLocalRouteLabel(request.path));
            localService.handle(request.method, request.path, request.query, request.headers,
                    request.body, out);
        } else if (LoopbackRoutes.isProxyable(request.path)) {
            log.info("proxy request " + request.method + " " + safeRouteLabel(request.path)
                    + safeRequestShape(request));
            if (!isAuthorised(request)) {
                writeSimple(out, 403, "loopback access denied");
                return;
            }
            proxy(request, out);
        } else {
            serveAsset(request, out);
        }
        out.flush();
    }

    /**
     * A local route label that is safe to log.
     *
     * <p>Only the fixed route prefix and the action are kept. The terminal session id is deliberately
     * dropped: it is a capability-shaped lookup key, and nothing here needs it to identify the
     * request. No body byte, header value or stream content is ever included.
     */
    private static String safeLocalRouteLabel(String path) {
        for (String prefix : LoopbackRoutes.LOCAL_PREFIXES) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) {
                return prefix;
            }
        }
        return "unlisted";
    }

    /**
     * A request line reduced to what is safe and useful to log: the method and which route it hit.
     *
     * <p>For tRPC the second segment is kept, because the procedure name is what identifies an auth
     * call ({@code auth.stytch.login}, {@code auth.me}). Everything after that is dropped so storage
     * keys and attachment paths never reach the log, and the query string is never included.
     */
    private static String safeRouteLabel(String path) {
        for (String prefix : LoopbackRoutes.PROXY_ALLOWLIST) {
            String base = prefix.endsWith("/") ? prefix.substring(0, prefix.length() - 1) : prefix;
            if (path.equals(base) || path.startsWith(base + "/")) {
                if (LoopbackRoutes.TRPC.equals(base)) {
                    String rest = path.substring(base.length());
                    if (rest.startsWith("/")) {
                        int slash = rest.indexOf('/', 1);
                        String procedure = slash < 0 ? rest.substring(1) : rest.substring(1, slash);
                        if (!procedure.isEmpty()) {
                            return base + "/" + procedure;
                        }
                    }
                }
                return base;
            }
        }
        return "unlisted";
    }

    /**
     * Request metadata that is safe to show a human: the media type, how many body bytes were read,
     * and whether that is exactly what the client declared.
     *
     * <p>Nothing here is derived from a credential. Only {@code Content-Type}, {@code Content-Length}
     * and {@code Transfer-Encoding} are named, no other header value is read, and not one body byte is
     * included or hashed. Together with the tRPC route label this is what proves, from the phone
     * alone, that the backend received the payload the client built - a body the proxy read short or
     * dropped shows up as a mismatch or as {@code bodyBytes=0} on a POST.
     */
    private static String safeRequestShape(Request request) {
        String declared = request.headers.get("content-length");
        String transferEncoding = request.headers.get("transfer-encoding");
        StringBuilder shape = new StringBuilder();
        shape.append(" contentType=").append(valueOrAbsent(request.headers.get("content-type")));
        shape.append(" bodyBytes=").append(request.body.length);
        shape.append(" declaredContentLength=").append(valueOrAbsent(declared));
        shape.append(" transferEncoding=").append(valueOrAbsent(transferEncoding));
        shape.append(" bodyMatchesDeclared=").append(declared == null
                ? "n/a"
                : String.valueOf(request.body.length == parseLengthOrMinusOne(declared)));
        return shape.toString();
    }

    private static String valueOrAbsent(String value) {
        return value == null ? "(absent)" : value;
    }

    private static int parseLengthOrMinusOne(String raw) {
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException notANumber) {
            return -1;
        }
    }

    /**
     * The credential is presented as a cookie by this app's own WebView. Other apps on the device
     * cannot read another app's cookie jar, and {@code HttpOnly} keeps it away from page scripts.
     */
    private boolean isAuthorised(Request request) {
        String cookie = request.headers.get("cookie");
        if (cookie == null) {
            return false;
        }
        String expected = ACCESS_COOKIE_NAME + "=" + accessSecret;
        for (String part : cookie.split(";")) {
            if (part.trim().equals(expected)) {
                return true;
            }
        }
        return false;
    }

    private Request readRequest(InputStream in) throws IOException {
        String requestLine = readLine(in, 8192);
        if (requestLine == null || requestLine.isEmpty()) {
            return null;
        }
        String[] parts = requestLine.split(" ");
        if (parts.length != 3) {
            return null;
        }

        Request request = new Request();
        request.correlationId = newCorrelationId();
        request.method = parts[0];

        // Only origin-form targets are accepted. Absolute-form ("GET http://host/x") and
        // authority-form are refused, so a client can never name the upstream.
        String target = parts[1];
        if (!target.startsWith("/") || target.startsWith("//")) {
            return null;
        }
        String rawPath = target;
        int q = target.indexOf('?');
        if (q >= 0) {
            rawPath = target.substring(0, q);
            request.query = target.substring(q + 1);
        }

        String decoded;
        try {
            decoded = URLDecoder.decode(rawPath, "UTF-8");
        } catch (Exception e) {
            return null;
        }
        // Traversal guard applied after decoding, so %2e%2e cannot slip through.
        if (decoded.contains("..") || decoded.indexOf('\0') >= 0) {
            return null;
        }
        request.path = decoded;

        int headerCount = 0;
        String header;
        while (true) {
            header = readLine(in, 8192);
            if (header == null) {
                return null;
            }
            if (header.isEmpty()) {
                break;
            }
            if (++headerCount > 100) {
                return null;
            }
            int colon = header.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            request.headers.put(
                    header.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                    header.substring(colon + 1).trim());
        }

        String transferEncoding = request.headers.get("transfer-encoding");
        if (transferEncoding != null && transferEncoding.toLowerCase(Locale.ROOT).contains("chunked")) {
            request.body = readChunkedBody(in);
        } else {
            String contentLength = request.headers.get("content-length");
            if (contentLength != null) {
                int length;
                try {
                    length = Integer.parseInt(contentLength.trim());
                } catch (NumberFormatException e) {
                    return null;
                }
                if (length < 0 || length > MAX_BODY_BYTES) {
                    return null;
                }
                request.body = readFully(in, length);
            }
        }
        return request;
    }

    private static byte[] readChunkedBody(InputStream in) throws IOException {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        while (true) {
            String sizeLine = readLine(in, 1024);
            if (sizeLine == null) {
                throw new IOException("truncated chunked body");
            }
            int semicolon = sizeLine.indexOf(';');
            if (semicolon >= 0) {
                sizeLine = sizeLine.substring(0, semicolon);
            }
            int size;
            try {
                size = Integer.parseInt(sizeLine.trim(), 16);
            } catch (NumberFormatException e) {
                throw new IOException("bad chunk size");
            }
            if (size == 0) {
                String trailer;
                while ((trailer = readLine(in, 1024)) != null && !trailer.isEmpty()) {
                    // discard trailers
                }
                return body.toByteArray();
            }
            if (body.size() + size > MAX_BODY_BYTES) {
                throw new IOException("chunked body too large");
            }
            body.write(readFully(in, size));
            readLine(in, 8); // CRLF that terminates the chunk data
        }
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] buffer = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(buffer, read, length - read);
            if (n < 0) {
                throw new IOException("unexpected end of body");
            }
            read += n;
        }
        return buffer;
    }

    private static String readLine(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') {
                byte[] bytes = buffer.toByteArray();
                int length = bytes.length;
                if (length > 0 && bytes[length - 1] == '\r') {
                    length--;
                }
                return new String(bytes, 0, length, StandardCharsets.ISO_8859_1);
            }
            if (buffer.size() >= limit) {
                throw new IOException("header line too long");
            }
            buffer.write(b);
        }
        return buffer.size() == 0 ? null : new String(buffer.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    // ---------------------------------------------------------------- proxy

    private void proxy(Request request, OutputStream out) throws IOException {
        final String corr = request.correlationId;
        final String route = safeRouteLabel(request.path);
        final long startedAtNanos = System.nanoTime();
        // Tracked so the failure line names the leg that actually broke, instead of only saying that
        // something upstream of the response failed. This transport sets a connect timeout but no read
        // timeout, so the value of this string is the whole point of the instrumentation: it is what
        // distinguishes a hang before the upstream is reachable from a hang while waiting for its answer.
        String phase = "build_target";
        log.info("diag proxy started; corr=" + corr + "; route=" + route + "; method=" + request.method
                + "; bodyBytes=" + request.body.length);
        try {
            // The upstream is fixed at construction; only path and query come from the request.
            String base = upstream.toString();
            StringBuilder target = new StringBuilder(base);
            if (base.endsWith("/") && request.path.startsWith("/")) {
                target.setLength(target.length() - 1);
            }
            target.append(request.path);
            if (request.query != null) {
                target.append('?').append(request.query);
            }

            HttpURLConnection connection = (HttpURLConnection) new URL(target.toString()).openConnection();
            try {
                phase = "upstream_connect";
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(request.method);
                connection.setConnectTimeout(15_000);
                connection.setUseCaches(false);

            // The backend derives cookie attributes from the protocol it believes it is serving. Over a
            // plaintext loopback hop req.protocol would be "http", making it emit SameSite=None without
            // Secure - a combination Chromium rejects. The upstream hop really is https, so declaring it
            // is accurate rather than a spoof, and it leaves the existing auth model untouched.
            connection.setRequestProperty("X-Forwarded-Proto", "https");
            connection.setRequestProperty("X-Forwarded-Host", upstream.getHost());

            for (Map.Entry<String, String> header : request.headers.entrySet()) {
                if (!HOP_BY_HOP.contains(header.getKey())) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }

                long connectStartedAtNanos = System.nanoTime();
                if (request.body.length > 0) {
                    // A body forces the connection here: DNS, TCP and TLS all complete inside
                    // getOutputStream(), so this branch can time connect separately from the answer.
                    phase = "upstream_connect";
                    log.info("diag upstream connect started; corr=" + corr + "; route=" + route);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Length", String.valueOf(request.body.length));
                    try (OutputStream upstreamOut = connection.getOutputStream()) {
                        upstreamOut.write(request.body);
                    }
                    log.info("diag upstream connection established; corr=" + corr + "; route=" + route
                            + "; connectMs=" + elapsedMs(connectStartedAtNanos));
                } else {
                    // No body, so there is nothing to force the connection early: getResponseCode()
                    // performs connect and the wait for the status line in one indivisible call. The
                    // reported figure is therefore connect plus response headers together, which
                    // `note=merged` says rather than leaving the reader to assume a connect-only time.
                    phase = "upstream_connect";
                    log.info("diag upstream connect started; corr=" + corr + "; route=" + route
                            + "; note=merged");
                }

                phase = "await_response_headers";
                long headersStartedAtNanos = System.nanoTime();
                int status = connection.getResponseCode();
                if (request.body.length == 0) {
                    log.info("diag upstream connection established; corr=" + corr + "; route=" + route
                            + "; connectAndHeadersMs=" + elapsedMs(connectStartedAtNanos));
                }
                log.info("diag upstream response received; corr=" + corr + "; route=" + route
                        + "; status=" + status
                        + "; awaitingHeadersMs=" + elapsedMs(headersStartedAtNanos)
                        + "; elapsedMs=" + elapsedMs(startedAtNanos));
                writeStatusLine(out, status, connection.getResponseMessage());

                // Counted, never read: the WebView has to accept these for the email sign-in to work,
            // and whether a session cookie was set is the difference between "the backend refused"
            // and "the cookie never reached the jar".
            int setCookieCount = 0;
            String responseContentType = null;
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                String name = header.getKey();
                if (name == null) {
                    continue; // status line pseudo-header
                }
                String lower = name.toLowerCase(Locale.ROOT);
                if (HOP_BY_HOP.contains(lower)) {
                    continue;
                }
                if ("content-type".equals(lower) && header.getValue() != null && !header.getValue().isEmpty()) {
                    responseContentType = header.getValue().get(0);
                }
                // Forwarded one by one so repeated headers - notably multiple Set-Cookie - survive as
                // separate lines instead of being collapsed into one.
                String canonical = CANONICAL_HEADERS.getOrDefault(lower, name);
                for (String value : header.getValue()) {
                    writeHeader(out, canonical, value);
                    if ("set-cookie".equals(lower)) {
                        setCookieCount++;
                    }
                }
            }
            log.info("proxy response " + status + " setCookieCount=" + setCookieCount
                    + " responseContentType=" + valueOrAbsent(responseContentType)
                    + " forwardedBodyBytes=" + request.body.length
                    + " for " + route);
            // No Content-Length for streamed bodies, so the client reads until close.
            writeHeader(out, "Connection", "close");
            out.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));

                phase = "read_response_body";
                long bodyStartedAtNanos = System.nanoTime();
                long delivered = 0L;
                InputStream source = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (source != null) {
                    delivered = pump(source, out);
                }
                log.info("diag response body delivered; corr=" + corr + "; route=" + route
                        + "; bodyBytes=" + delivered + "; bodyMs=" + elapsedMs(bodyStartedAtNanos)
                        + "; elapsedMs=" + elapsedMs(startedAtNanos));
                log.info("diag proxy completed; corr=" + corr + "; route=" + route
                        + "; status=" + status + "; totalMs=" + elapsedMs(startedAtNanos));
            } finally {
                connection.disconnect();
            }
        } catch (IOException failure) {
            // Re-thrown unchanged: the caller still closes the socket exactly as before. This line only
            // records which leg had not completed, so a multi-minute wait followed by a failure is
            // attributable to connect, to headers or to the body.
            log.warn("diag proxy failed; corr=" + corr + "; route=" + route + "; phase=" + phase
                    + "; elapsedMs=" + elapsedMs(startedAtNanos), failure);
            throw failure;
        }
    }

    /**
     * Copies upstream bytes to the client as they arrive, flushing per chunk. This is what keeps
     * {@code /api/chat/stream} a real stream rather than one buffered blob delivered at the end.
     *
     * <p>Returns the number of bytes written, which is what lets the caller separate "the answer
     * arrived and was large" from "the answer arrived and was small" without reading any content.
     */
    private long pump(InputStream source, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        long delivered = 0L;
        int read;
        while ((read = source.read(buffer)) != -1) {
            out.write(buffer, 0, read);
            out.flush();
            delivered += read;
        }
        return delivered;
    }

    /**
     * The route label for the accept line: local prefix, proxied procedure or asset path.
     *
     * <p>Uses exactly the same labelling as the three branches above, so the accept line and the
     * later phase lines of one request always carry the identical string.
     */
    private static String routeLabelForDiagnostics(Request request) {
        if (safeLocalRouteLabel(request.path).equals("unlisted")) {
            return LoopbackRoutes.isProxyable(request.path)
                    ? safeRouteLabel(request.path)
                    : "asset";
        }
        return safeLocalRouteLabel(request.path);
    }

    // ---------------------------------------------------------------- static files

    private void serveAsset(Request request, OutputStream out) throws IOException {
        long startedAtNanos = System.nanoTime();
        String relative = request.path.startsWith("/") ? request.path.substring(1) : request.path;
        byte[] content = relative.isEmpty() ? null : readSafely(relative);
        boolean usedIndexFallback = content == null;
        if (usedIndexFallback) {
            // SPA fallback, matching server/_core/vite.ts serveStatic behaviour.
            content = readSafely("index.html");
        }
        // The bundled page and its scripts are served through this same listener, so the first paint
        // is a loopback leg too. Recording its size and duration is what keeps "the app was slow to
        // open" separable from "the first API call was slow": a multi-megabyte asset read out of the
        // APK on every launch is a plausible cause of the same symptom from a completely different place.
        log.info("diag asset read; corr=" + request.correlationId
                + "; servedIndexFallback=" + usedIndexFallback
                + "; bytes=" + (content == null ? 0 : content.length)
                + "; readMs=" + elapsedMs(startedAtNanos));
        if (content == null) {
            writeSimple(out, 404, "not found");
            return;
        }
        String name = relative.isEmpty() ? "index.html" : relative;
        writeStatusLine(out, 200, "OK");
        writeHeader(out, "Content-Type", contentType(name));
        // Bundled assets are replaced wholesale by OTA; never let the WebView reuse a stale one.
        writeHeader(out, "Cache-Control", "no-store");
        writeHeader(out, "Content-Length", String.valueOf(content.length));
        writeHeader(out, "Connection", "close");
        out.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
        out.write(content);
        out.flush();
    }

    private byte[] readSafely(String relativePath) {
        if (relativePath.contains("..") || relativePath.startsWith("/")) {
            return null;
        }
        return staticSource.read(relativePath);
    }

    private static String contentType(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- helpers

    private static void writeStatusLine(OutputStream out, int status, String reason) throws IOException {
        writeHeader(out, null, "HTTP/1.1 " + status + " " + (reason == null ? "" : reason) + "\r\n");
    }

    private static void writeHeader(OutputStream out, String name, String value) throws IOException {
        String line = name == null ? value : name + ": " + value + "\r\n";
        out.write(line.getBytes(StandardCharsets.ISO_8859_1));
    }

    private void writeSimple(OutputStream out, int status, String message) throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        writeStatusLine(out, status, status == 404 ? "Not Found" : status == 403 ? "Forbidden" : "Bad Request");
        writeHeader(out, "Content-Type", "text/plain; charset=utf-8");
        writeHeader(out, "Content-Length", String.valueOf(body.length));
        writeHeader(out, "Connection", "close");
        out.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }
}