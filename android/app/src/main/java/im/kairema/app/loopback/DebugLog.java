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
 * Debug-only, phone-readable diagnostics for the loopback shell.
 *
 * <p>The user has no PC, no adb and no logcat, so when the shell fails to load the loopback origin
 * the only way to find out why is to read the failure off the phone itself. Every event is appended
 * to an app-private file in {@code filesDir}, which the debug diagnostics screen can display and
 * copy to the clipboard.
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

    /** Bumped when a failure mode is added, so the two builds stay comparable. */
    public static final int SCHEMA_VERSION = 1;

    private static final String FILE_NAME = "kairema-loopback-debug.log";

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

        String stamp = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date());
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
