package im.kairema.app.terminal;

import im.kairema.app.loopback.LoopbackLocalService;
import im.kairema.app.loopback.LoopbackRoutes;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import im.kairema.app.loopback.DebugLog;

/**
 * The on-device terminal API, served by the existing loopback origin.
 *
 * <p>Routes, all under {@link LoopbackRoutes#LOCAL_TERMINAL}:
 *
 * <pre>
 *   POST /api/local/terminal/session          create a session
 *   POST /api/local/terminal/{id}/input       write stdin
 *   GET  /api/local/terminal/{id}/stream      stream stdout/stderr/exit as NDJSON
 *   POST /api/local/terminal/{id}/kill        stop a session
 *   GET  /api/local/terminal/status           count live sessions
 * </pre>
 *
 * <p>Authentication is the existing {@code kairema_loopback} cookie, checked by the transport
 * before this class is called. There is no second secret, no token in a URL and no credential in
 * the shell's environment. A session id in the path is a lookup key only: an attacker who learns
 * one still cannot reach it without the cookie, and the loopback port is bound to 127.0.0.1 so no
 * other app can connect at all.
 *
 * <p>Nothing here reaches the upstream. The path prefix is deliberately outside
 * {@link LoopbackRoutes#PROXY_ALLOWLIST}, so the backend can neither see nor be asked to run a
 * command, and no existing proxy route changes behaviour.
 */
public final class TerminalRoutes implements LoopbackLocalService {

    private static final String PREFIX = LoopbackRoutes.LOCAL_TERMINAL;

    /** Longest stdin write accepted in one request, to bound a single call. */
    private static final int MAX_INPUT_BYTES = 64 * 1024;

    /**
     * How long a stream request waits before emitting a keepalive.
     *
     * <p>The WebView would otherwise treat an idle shell as a stalled connection, and an Android
     * proxy in between may drop an idle socket. A keepalive is a comment-style NDJSON line the
     * client skips, so it cannot be confused with terminal output.
     */
    private static final long KEEPALIVE_MILLIS = 10_000;

    /** The stream is closed this long after the process exits, so the exit frame is always read. */
    private static final long POST_EXIT_GRACE_MILLIS = 750;

    private final TerminalSessions sessions;

    public TerminalRoutes(TerminalSessions sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean handles(String path) {
        return ownsPath(path);
    }

    /**
     * Whether this service owns the path.
     *
     * <p>Static because the decision is purely about the path prefix and must be verifiable without
     * an Android context: a route that the terminal claims but that is also proxyable, or the
     * reverse, would silently change where a request is executed.
     */
    public static boolean ownsPath(String path) {
        return path != null
                && (path.equals(PREFIX) || path.startsWith(PREFIX + "/"));
    }

    @Override
    public void handle(String method, String path, String query, Map<String, String> headers,
            byte[] body, OutputStream out) throws IOException {
        String rest = path.substring(PREFIX.length());

        if (rest.isEmpty() || rest.equals("/")) {
            if ("GET".equals(method)) {
                writeStatus(out);
            } else {
                writeError(out, 405, "method_not_allowed");
            }
            return;
        }
        if (rest.equals("/session")) {
            if (!"POST".equals(method)) {
                writeError(out, 405, "method_not_allowed");
                return;
            }
            createSession(out);
            return;
        }
        if (rest.equals("/status")) {
            if (!"GET".equals(method)) {
                writeError(out, 405, "method_not_allowed");
                return;
            }
            writeStatus(out);
            return;
        }

        // /{id}/action
        String[] segments = splitPath(rest);
        if (segments.length != 2 || !TerminalSessions.isValidSessionId(segments[0])) {
            // An unknown or malformed id is refused without touching any session. The response is
            // the same for "no such session" and "malformed id" so the endpoint does not become an
            // oracle for valid ids.
            writeError(out, 404, "no_such_session");
            return;
        }
        String sessionId = segments[0];
        String action = segments[1];

        if (action.equals("input")) {
            if (!"POST".equals(method)) {
                writeError(out, 405, "method_not_allowed");
                return;
            }
            writeInput(sessionId, body, out);
            return;
        }
        if (action.equals("stream")) {
            if (!"GET".equals(method)) {
                writeError(out, 405, "method_not_allowed");
                return;
            }
            stream(sessionId, out);
            return;
        }
        if (action.equals("kill")) {
            if (!"POST".equals(method)) {
                writeError(out, 405, "method_not_allowed");
                return;
            }
            kill(sessionId, out);
            return;
        }
        writeError(out, 404, "not_found");
    }

    // ---------------------------------------------------------------- routes

    private void createSession(OutputStream out) throws IOException {
        // The request body is never read here and never logged: it can carry a command. Only the
        // outcome and a fixed reason token reach the log.
        DebugLog.event("terminal routes: createSession request accepted");
        String[] failure = new String[1];
        TerminalSession session = sessions.start(failure);
        if (session == null) {
            // 503 for an unavailable runtime and 429 for the session cap: the client can tell a
            // transient condition from "close one first", and neither leaks a path.
            //
            // The `error` token stays `runtime_unavailable` so the existing page keeps its message,
            // but it no longer carries the whole truth: `reason` names which of the four distinct
            // failures actually happened, and the same token is in the log next to the cause.
            String reason = failure[0] == null ? "unknown" : failure[0];
            DebugLog.event("terminal routes: createSession rejected; reason=" + reason);
            if ("session_limit".equals(reason)) {
                writeError(out, 429, "session_limit", reason);
            } else {
                writeError(out, 503, "runtime_unavailable", reason);
            }
            return;
        }
        DebugLog.event("terminal routes: createSession succeeded");
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("id", session.getId());
        fields.put("cwd", TerminalRuntime.GUEST_HOME);
        writeJson(out, 200, fields);
    }

    private void writeStatus(OutputStream out) throws IOException {
        sessions.reap();
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("sessions", String.valueOf(sessions.count()));
        fields.put("max", String.valueOf(TerminalSessions.MAX_SESSIONS));
        fields.put("ready", String.valueOf(sessions.getRuntime().isReady()));
        writeJson(out, 200, fields);
    }

    private void writeInput(String sessionId, byte[] body, OutputStream out) throws IOException {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            writeError(out, 404, "no_such_session");
            return;
        }
        if (body.length > MAX_INPUT_BYTES) {
            writeError(out, 413, "input_too_large");
            return;
        }

        byte[] payload;
        if (body.length == 0) {
            payload = new byte[0];
        } else {
            try {
                Map<String, String> parsed = Json.readFlatObject(
                        new String(body, StandardCharsets.UTF_8));
                String data = parsed.get("data");
                if (data == null) {
                    writeError(out, 400, "missing_data");
                    return;
                }
                payload = data.getBytes(StandardCharsets.UTF_8);
            } catch (Json.MalformedJsonException malformed) {
                writeError(out, 400, "malformed_body");
                return;
            }
        }
        if (payload.length > MAX_INPUT_BYTES) {
            writeError(out, 413, "input_too_large");
            return;
        }

        try {
            session.writeInput(payload);
        } catch (IOException closed) {
            writeError(out, 409, "session_closed");
            return;
        }
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("written", String.valueOf(payload.length));
        writeJson(out, 200, fields);
    }

    private void kill(String sessionId, OutputStream out) throws IOException {
        boolean existed = sessions.kill(sessionId);
        if (!existed) {
            writeError(out, 404, "no_such_session");
            return;
        }
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("killed", "true");
        writeJson(out, 200, fields);
    }

    /**
     * Streams frames as NDJSON, flushing each one.
     *
     * <p>No Content-Length and {@code Connection: close}, so the client reads until the socket
     * closes. A keepalive line is written whenever the queue is idle long enough that the WebView
     * might otherwise consider the connection dead.
     */
    private void stream(String sessionId, OutputStream out) throws IOException {
        TerminalSession session = sessions.get(sessionId);
        if (session == null) {
            writeError(out, 404, "no_such_session");
            return;
        }

        writeHead(out);
        out.flush();

        boolean sentTruncationNotice = false;
        long exitedAt = 0;
        while (true) {
            String frame;
            try {
                frame = session.pollFrame(KEEPALIVE_MILLIS);
            } catch (InterruptedException interrupted) {
                // The worker thread is being torn down with the app; ending the stream is correct.
                Thread.currentThread().interrupt();
                return;
            }
            if (frame == null) {
                if (session.isTruncated() && !sentTruncationNotice) {
                    // Told once, and explicitly: output is never dropped silently.
                    writeLine(out, Json.frame("error", "output_truncated"));
                    sentTruncationNotice = true;
                }
                if (session.hasExited()) {
                    if (exitedAt == 0) {
                        exitedAt = System.currentTimeMillis();
                    } else if (System.currentTimeMillis() - exitedAt >= POST_EXIT_GRACE_MILLIS) {
                        // The exit frame is queued before hasExited() is observed, so it is already
                        // drained; the short grace period is belt and braces for a slow reader.
                        return;
                    }
                }
                if (!session.isClosed()) {
                    writeLine(out, "{\"type\":\"keepalive\"}");
                } else {
                    return;
                }
                continue;
            }
            writeLine(out, frame);
            if (frame.contains("\"type\":\"exit\"")) {
                return;
            }
        }
    }

    // ---------------------------------------------------------------- response helpers

    private static void writeHead(OutputStream out) throws IOException {
        out.write(("HTTP/1.1 200 OK\r\n"
                + "Content-Type: application/x-ndjson; charset=utf-8\r\n"
                + "Cache-Control: no-store\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Connection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void writeLine(OutputStream out, String frame) throws IOException {
        out.write(frame.getBytes(StandardCharsets.UTF_8));
        out.write('\n');
        out.flush();
    }

    private static void writeJson(OutputStream out, int status, Map<String, String> fields)
            throws IOException {
        byte[] payload = Json.writeObject(fields).getBytes(StandardCharsets.UTF_8);
        out.write(("HTTP/1.1 " + status + " " + reason(status) + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + payload.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.write(payload);
        out.flush();
    }

    /**
     * Writes a stable error token.
     *
     * <p>Only the token is sent. No exception message, path or digest is included, so a failure can
     * never describe the runtime's private directory layout to the page.
     */
    private static void writeError(OutputStream out, int status, String token) throws IOException {
        writeError(out, status, token, null);
    }

    /**
     * Writes an error body.
     *
     * <p>{@code reason} is a fixed token from a closed set, never a message from the platform, so it
     * is safe to add to the response.
     */
    private static void writeError(OutputStream out, int status, String token, String reason)
            throws IOException {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("error", token);
        if (reason != null && !reason.equals(token)) {
            fields.put("reason", reason);
        }
        writeJson(out, status, fields);
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            case 503: return "Service Unavailable";
            default: return "Error";
        }
    }

    /** Splits a path into its non-empty segments, rejecting anything unexpected. */
    private static String[] splitPath(String rest) {
        String trimmed = rest.startsWith("/") ? rest.substring(1) : rest;
        if (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        List<String> segments = new java.util.ArrayList<>(2);
        for (String segment : trimmed.split("/")) {
            if (!segment.isEmpty()) {
                segments.add(segment);
            }
        }
        return segments.toArray(new String[0]);
    }
}
