package im.kairema.app.loopback;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Debug-only, phone-readable diagnostics for the loopback shell and the on-device terminal runtime.
 *
 * <p>The user has no PC, no adb and no logcat, so when the shell fails to load the loopback origin,
 * or when a terminal session cannot start, the only way to find out why is to read the failure off
 * the phone itself. Every event is appended to an app-private file in {@code filesDir}, which the
 * debug diagnostics screen can display and copy to the clipboard.
 *
 * <p>Two properties matter more than convenience here:
 *
 * <ul>
 *   <li><b>It never records a secret.</b> Every line passes through {@link #sanitize(String)} before
 *       it is written, which redacts URLs, header-ish {@code name=value} pairs and long opaque
 *       tokens. Exception messages are sanitized too, and stack traces are not written at all unless
 *       a caller asks for a sanitized one.
 *   <li><b>It cannot grow without bound.</b> The file is capped, keeping the newest bytes, because it
 *       is rewritten on every app start.
 * </ul>
 *
 * <p>Writes are best effort. Diagnostics must never be the reason the app fails to start, so every
 * failure to write is swallowed.
 */
public final class DebugLog {

    /**
     * Bumped when a failure mode is added, so the two builds stay comparable.
     *
     * <p>Version 2 adds the on-device terminal runtime events: installation phases, session launch,
     * and process exit. That is what a user sends back instead of a logcat excerpt, so the schema
     * number tells a reader which build produced a pasted log.
     * <p>Version 3 adds the authentication startup timing events: a correlation id per proxied
 * request, a phase name and an elapsed-millisecond count, so a multi-minute stall can be
 * attributed to one leg (WebView to loopback, loopback to upstream connect, upstream response
 * headers, response body, delivery back to the WebView) instead of being observed only as "the
 * app took a long time to start". It also stamps the calendar date, so a delta between two lines
 * from different launches can no longer be ambiguous across midnight.
     */
    public static final int SCHEMA_VERSION = 3;

    private static final String FILE_NAME = "kairema-loopback-debug.log";

    /** What the screen shows when the log is initialised but holds nothing. */
    public static final String EMPTY = "(diagnostics log is empty)";

    /** Hard cap on the on-device file. Oldest bytes are discarded first. */
    private static final long MAX_BYTES = 64 * 1024L;

    /** Bytes kept when trimming. Leaves headroom so the trim is not done on every write. */
    private static final long KEEP_BYTES = 48 * 1024L;

    private static final Object LOCK = new Object();

    private static File file;

    private DebugLog() {
    }

    /** Points the logger at the app's private files directory. Safe to call repeatedly. */
    public static void init(Context context) {
        synchronized (LOCK) {
            file = new File(context.getFilesDir(), FILE_NAME);
        }
    }

    /**
     * Points the logger at an explicit file instead of {@code filesDir}.
     *
     * <p>Package-private and used only by {@link DebugLogTest}, which runs on a plain JVM where no
     * {@link Context} exists. It is not a second way to redirect the log at runtime: nothing outside
     * this package can reach it.
     */
    static void initForTest(File target) {
        synchronized (LOCK) {
            file = target;
        }
    }

    public static boolean isEnabled() {
        synchronized (LOCK) {
            return file != null;
        }
    }

    /** Appends one timestamped event after sanitizing it. Never throws. */
    public static void event(String message) {
        append("INFO", message, null);
    }

    /** Appends one timestamped failure. The throwable's message is sanitized; the trace is not written. */
    public static void failure(String message, Throwable error) {
        append("ERROR", message, error);
    }

    private static void append(String level, String message, Throwable error) {
        File target;
        synchronized (LOCK) {
            target = file;
        }
        if (target == null) {
            return;
        }

        // Calendar date as well as wall-clock time: a reader comparing two lines from different
        // launches must be able to tell "45 seconds apart" from "45 minutes and one day apart".
        String stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
        StringBuilder line = new StringBuilder();
        line.append(stamp).append(' ').append(level).append(' ').append(sanitize(message));
        if (error != null) {
            // Type plus sanitized message only. A stack trace can carry a URL or a token in a
            // message, and sanitizing a full trace reliably is harder than not writing it.
            line.append(" | ").append(error.getClass().getSimpleName());
            if (error.getMessage() != null) {
                line.append(": ").append(sanitize(error.getMessage()));
            }
        }

        synchronized (LOCK) {
            try {
                FileOutputStream out = new FileOutputStream(target, true);
                try {
                    out.write((line.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                } finally {
                    out.close();
                }
                trim(target);
            } catch (IOException ignored) {
                // Diagnostics must never break startup.
            }
        }
    }

    /** Keeps the newest {@link #KEEP_BYTES} of the file so it stays under {@link #MAX_BYTES}. */
    private static void trim(File target) throws IOException {
        if (target.length() <= MAX_BYTES) {
            return;
        }
        RandomAccessFile source = new RandomAccessFile(target, "r");
        try {
            long start = target.length() - KEEP_BYTES;
            byte[] kept = new byte[(int) KEEP_BYTES];
            source.seek(start);
            source.readFully(kept);
            FileOutputStream out = new FileOutputStream(target, false);
            try {
                out.write(kept);
            } finally {
                out.close();
            }
        } finally {
            source.close();
        }
    }

    /** Whole log, oldest first, for the diagnostics screen. Never throws. */
    public static String readAll() {
        File target;
        synchronized (LOCK) {
            target = file;
        }
        if (target == null) {
            return "(diagnostics not initialised)";
        }
        // A missing file is the normal state right after clear(), not an error: an open on a
        // deleted file would otherwise be reported to the user as a read failure.
        if (!target.isFile()) {
            return EMPTY;
        }
        try {
            RandomAccessFile source = new RandomAccessFile(target, "r");
            try {
                byte[] bytes = new byte[(int) Math.min(source.length(), MAX_BYTES)];
                source.readFully(bytes);
                return new String(bytes, StandardCharsets.UTF_8);
            } finally {
                source.close();
            }
        } catch (IOException e) {
            return "(could not read diagnostics: " + e.getClass().getSimpleName() + ")";
        }
    }

    /**
     * Empties the log.
     *
     * <p>Only this file is touched: no runtime state, no installed files, no settings. A user
     * clearing the log is discarding diagnostics, not resetting the app, so nothing else may be
     * involved. Best effort, like every other write here.
     */
    public static void clear() {
        File target;
        synchronized (LOCK) {
            target = file;
        }
        if (target == null) {
            return;
        }
        synchronized (LOCK) {
            boolean cleared = !target.exists() || target.delete();
            if (!cleared) {
                // Truncating is the fallback: some filesystems refuse an unlink of a mapped file, and
                // an empty log is still the state the user asked for.
                try (FileOutputStream out = new FileOutputStream(target, false)) {
                    out.flush();
                } catch (IOException ignored) {
                    // Nothing useful to do: the log stays as it was rather than breaking the screen.
                }
            }
        }
    }

    // ---------------------------------------------------------------- redaction

    /**
     * Strips anything that could be a secret from a line before it is written.
     *
     * <p>Applied to every line and to every exception message. It is deliberately aggressive: a
     * redacted log is still useful for diagnosing a loopback failure, whereas a leaked token is not
     * recoverable.
     */
    static String sanitize(String raw) {
        if (raw == null) {
            return "";
        }
        String out = raw;
        // Explicit header/field names, with or without a separator.
        out = PATTERN_HEADER_VALUE.matcher(out).replaceAll("$1=<redacted>");
        out = PATTERN_BEARER.matcher(out).replaceAll("Bearer <redacted>");
        out = PATTERN_URL.matcher(out).replaceAll("<url>");
        out = PATTERN_LONG_TOKEN.matcher(out).replaceAll("<redacted>");
        return out;
    }

    /** Matches a cookie, and any field whose name looks sensitive, up to its value. */
    private static final Pattern PATTERN_HEADER_VALUE = Pattern.compile(
            "(?i)\\b(set-cookie|cookie|authorization|bearer|token|api[-_ ]?key|apikey|secret|password|passwd|session)"
                    + "\\b\\s*[:=]\\s*[^\\s;,]+");

    private static final Pattern PATTERN_BEARER = Pattern.compile("(?i)\\bbearer\\s+[A-Za-z0-9._~+/=-]+");

    /** Any scheme-qualified URL, so no host or path ever reaches the file. */
    private static final Pattern PATTERN_URL = Pattern.compile("(?i)\\b[a-z][a-z0-9+.-]*://[^\\s\"'<>]+");

    /** Long opaque runs: session tokens, hex secrets, base64 cookies. */
    private static final Pattern PATTERN_LONG_TOKEN = Pattern.compile("(?<![A-Za-z0-9])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9])");
}
