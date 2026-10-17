package im.kairema.app.terminal;

import android.content.Context;
import android.util.Log;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Owns every live terminal session.
 *
 * <p>Kept separate from both the process and the HTTP layer: this is the only place that decides how
 * many sessions may exist, what an id looks like, and what happens when one is created while others
 * are still running.
 */
public final class TerminalSessions {

    private static final String TAG = "KairemaTerminal";

    /** First MVP limit. Four shells is already generous for a phone. */
    public static final int MAX_SESSIONS = 4;

    /**
     * Session ids are 128 bits of {@link SecureRandom} in lowercase hex, so 32 characters.
     *
     * <p>Checked with a pattern rather than trusted, because an id arrives from a URL: a caller
     * controls the path and must not be able to name a session that never existed, or smuggle a
     * traversal into the id before it reaches a map lookup.
     */
    private static final Pattern SESSION_ID = Pattern.compile("^[0-9a-f]{32}$");

    private static final SecureRandom RANDOM = new SecureRandom();

    private final TerminalRuntime runtime;
    private final Map<String, TerminalSession> sessions =
            Collections.synchronizedMap(new LinkedHashMap<String, TerminalSession>());

    public TerminalSessions(Context context) {
        this.runtime = TerminalRuntime.get(context);
    }

    public TerminalRuntime getRuntime() {
        return runtime;
    }

    /**
     * A fresh, cryptographically random session id.
     *
     * <p>{@code SecureRandom} is seeded by the platform, and 32 hex characters carry 128 bits, so an
     * id cannot be guessed or enumerated. It is still only a lookup key: authorisation comes from
     * the loopback cookie, and an id never grants access on its own.
     */
    static String newSessionId() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return TerminalRuntime.hex(bytes);
    }

    /** Whether a path segment is a syntactically valid session id. */
    public static boolean isValidSessionId(String candidate) {
        return candidate != null && SESSION_ID.matcher(candidate).matches();
    }

    /** Why a session could not be created, as a stable token safe to return to the client. */
    public enum StartFailure {
        RUNTIME_UNAVAILABLE,
        SESSION_LIMIT,
        LAUNCH_FAILED
    }

    /**
     * Creates a session, or returns null with {@code failure} set.
     *
     * <p>Expired sessions are reaped first, so a session that timed out frees its slot. The limit is
     * checked and the new session inserted under one lock, so two concurrent requests cannot both
     * observe a free slot and exceed the cap.
     */
    public TerminalSession start(String[] outFailure) {
        runtime.ensureInstalled();
        if (!runtime.awaitReady(30_000)) {
            outFailure[0] = "runtime_unavailable";
            return null;
        }

        synchronized (sessions) {
            reapExpiredLocked();
            if (sessions.size() >= MAX_SESSIONS) {
                outFailure[0] = "session_limit";
                return null;
            }
            String id = newSessionId();
            TerminalSession session;
            try {
                session = new TerminalSession(id, runtime);
            } catch (IOException | RuntimeException failed) {
                // The reason is not propagated: it can contain a filesystem path.
                Log.w(TAG, "could not start a terminal process");
                outFailure[0] = "launch_failed";
                return null;
            }
            sessions.put(id, session);
            return session;
        }
    }

    /** Looks up a live session, or null if the id is unknown or malformed. */
    public TerminalSession get(String id) {
        if (!isValidSessionId(id)) {
            return null;
        }
        return sessions.get(id);
    }

    /**
     * Stops a session and removes it.
     *
     * @return true if a session existed and was stopped
     */
    public boolean kill(String id) {
        if (!isValidSessionId(id)) {
            return false;
        }
        TerminalSession session;
        synchronized (sessions) {
            session = sessions.remove(id);
        }
        if (session == null) {
            return false;
        }
        session.close();
        return true;
    }

    /** Stops every session, used when the activity is destroyed. */
    public void shutdownAll() {
        List<TerminalSession> all;
        synchronized (sessions) {
            all = new ArrayList<>(sessions.values());
            sessions.clear();
        }
        for (TerminalSession session : all) {
            session.close();
        }
    }

    /** Drops sessions that have exited or exceeded the maximum lifetime. */
    public void reap() {
        synchronized (sessions) {
            reapExpiredLocked();
        }
    }

    private void reapExpiredLocked() {
        List<String> doomed = new ArrayList<>();
        for (Map.Entry<String, TerminalSession> entry : sessions.entrySet()) {
            TerminalSession session = entry.getValue();
            if (session.hasExpired() || (session.hasExited() && session.isClosed())) {
                doomed.add(entry.getKey());
            }
        }
        for (String id : doomed) {
            TerminalSession session = sessions.remove(id);
            if (session != null) {
                session.close();
            }
        }
    }

    /** Current live session count, for status reporting and tests. */
    public int count() {
        return sessions.size();
    }
}
