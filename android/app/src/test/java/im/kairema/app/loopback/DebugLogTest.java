package im.kairema.app.loopback;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;

/**
 * Redaction and lifecycle of the phone-only diagnostics log.
 *
 * <p>Runs on a plain JVM: no {@link android.content.Context} exists here, so the file target is set
 * directly. That is the point of the cases below. The redaction patterns are the only thing standing
 * between an exception message and a chat window, and a mistake in them is invisible until a user
 * pastes the log somewhere public.
 */
public class DebugLogTest {

    @Rule
    public final TemporaryFolder folder = new TemporaryFolder();

    private File logFile;

    @Before
    public void pointTheLogAtATemporaryFile() throws IOException {
        logFile = folder.newFile("debug.log");
        DebugLog.initForTest(logFile);
    }

    @After
    public void forgetTheLogTarget() {
        // The logger is static, so a leaked target would let one test's file be asserted by another.
        DebugLog.initForTest(null);
    }

    // ---------------------------------------------------------------- redaction

    @Test
    public void redactsAPassword() {
        String out = DebugLog.sanitize("login failed for password=hunter2secretvalue");
        assertFalse("the password reached the log", out.contains("hunter2secretvalue"));
        assertTrue("the field name is kept so the reader knows what was redacted: " + out,
                out.contains("<redacted>"));
    }

    @Test
    public void redactsAnApiKey() {
        String out = DebugLog.sanitize("provider rejected api_key=sk-proj-0123456789abcdefghij");
        assertFalse(out.contains("sk-proj-0123456789abcdefghij"));
    }

    @Test
    public void redactsACookie() {
        String out = DebugLog.sanitize("Cookie: kairema_loopback=9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c");
        assertFalse("a cookie value reached the log", out.contains("9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"));
    }

    @Test
    public void redactsABearerToken() {
        String out = DebugLog.sanitize("header Authorization: Bearer abc123DEF456ghi789JKL012");
        assertFalse("a bearer token reached the log", out.contains("abc123DEF456ghi789JKL012"));
    }

    @Test
    public void redactsABearerTokenWithoutAFieldName() {
        String out = DebugLog.sanitize("retrying with bearer abc123DEF456ghi789JKL012");
        assertFalse(out.contains("abc123DEF456ghi789JKL012"));
        assertTrue(out.contains("Bearer <redacted>"));
    }

    @Test
    public void redactsTheWholeUrl() {
        String out = DebugLog.sanitize("GET http://127.0.0.1:41234/index.html finished");
        assertFalse("a host reached the log", out.contains("127.0.0.1"));
        assertTrue(out.contains("<url>"));
    }

    @Test
    public void redactsAnUnlabelledLongToken() {
        String out = DebugLog.sanitize("staged blob 9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c staged");
        assertFalse(out.contains("9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"));
    }

    @Test
    public void keepsTheTokensADiagnosisDependsOn() {
        // The whole value of the log is a phase name, a flag or a count. Aggressive redaction is only
        // acceptable as long as these survive, so they are asserted rather than assumed.
        assertEquals("terminal runtime: install failure; phase=install_io; failureToken=install_failed",
                DebugLog.sanitize("terminal runtime: install failure; phase=install_io; "
                        + "failureToken=install_failed"));
        assertEquals("terminal session process exited; exitCode=127; ageMillis=12",
                DebugLog.sanitize("terminal session process exited; exitCode=127; ageMillis=12"));
        assertEquals("sessions.live=0/4; schema=2",
                DebugLog.sanitize("sessions.live=0/4; schema=2"));
    }

    @Test
    public void everyLineTheAppActuallyEmitsSurvivesRedactionIntact() {
        // The mirror image of the redaction cases: if a pattern ever starts matching one of the
        // strings below, the log the user is asked to send stops saying anything. This is the only
        // place the real event vocabulary is written down, so a renamed phase shows up here first.
        String[] emitted = {
            "terminal runtime: ensureInstalled called; ready=false; markerPresent=false; "
                    + "installInFlight=false",
            "terminal runtime: ensureInstalled fast path, already ready",
            "terminal runtime: ensureInstalled fast path, became ready",
            "terminal runtime: installation already in progress, joining it",
            "terminal runtime: marker present and files verified, adopting install",
            "terminal runtime: ready=true (adopted existing installation)",
            "terminal runtime: install started",
            "terminal runtime: awaitReady started; timeoutMillis=30000; ready=false; "
                    + "markerPresent=false",
            "terminal runtime: awaitReady completed; ready=true",
            "terminal runtime: awaitReady timed out; ready=false; markerPresent=false",
            "terminal runtime: installBlocking started",
            "terminal runtime: install phase remove_previous",
            "terminal runtime: install phase runtime_dir_ready",
            "terminal runtime: install phase natives_complete",
            "terminal runtime: install phase rootfs_complete",
            "terminal runtime: marker being written",
            "terminal runtime: marker written",
            "terminal runtime: ready=true",
            "terminal runtime: installNatives started",
            "terminal runtime: proot verification started",
            "terminal runtime: proot verification completed",
            "terminal runtime: libtalloc verification started",
            "terminal runtime: libtalloc verification completed",
            "terminal runtime: libandroid-shmem verification started",
            "terminal runtime: libandroid-shmem verification completed",
            "terminal runtime: installNatives completed",
            "terminal runtime: installRootfs started",
            "terminal runtime: rootfs digest pass started",
            "terminal runtime: rootfs digest pass completed",
            "terminal runtime: rootfs extraction started",
            "terminal runtime: rootfs extraction completed",
            "terminal runtime: installRootfs completed",
            "terminal runtime: install failure; phase=install_io; failureToken=install_failed",
            "terminal runtime: install failure; phase=mkdir_runtime_dir; failureToken=install_root",
            "terminal sessions: start entered; ready=false; live=0/4",
            "terminal sessions: runtime unavailable; failureToken=install_failed; markerPresent=false",
            "terminal sessions: rejected, session limit reached; live=4",
            "terminal sessions: session created; live=1/4",
            "terminal session launch started; runtimeReady=true",
            "terminal session ProcessBuilder.start succeeded; pid=12345",
            "terminal session ProcessBuilder.start failed",
            "terminal session process exited; exitCode=127; ageMillis=12",
            "terminal routes: createSession request accepted",
            "terminal routes: createSession rejected; reason=runtime_unavailable",
            "terminal routes: createSession rejected; reason=session_limit",
            "terminal routes: createSession succeeded",
            "main activity: diagnostics screen opened",
            "main activity: diagnostics retry requested",
            "diagnostics: log cleared by user",
            "diagnostics: retry requested by user",
            "MainActivity onCreate, schema 2",
        };
        for (String line : emitted) {
            assertEquals("redaction damaged a real log line: " + line, line, DebugLog.sanitize(line));
        }
    }

    // ---------------------------------------------------------------- null safety

    @Test
    public void aNullMessageBecomesAnEmptyLine() {
        assertEquals("", DebugLog.sanitize(null));
    }

    @Test
    public void aNullMessageIsAcceptedAtEveryEntryPoint() {
        // Never throws, and never writes the word "null" that would read like a real value.
        DebugLog.event(null);
        DebugLog.failure("failed", null);
        String written = DebugLog.readAll();
        assertFalse(written, written.contains("null"));
    }

    @Test
    public void aFailureWithNoMessageStillRecordsItsType() {
        DebugLog.failure("install failed", new IllegalStateException());
        String written = DebugLog.readAll();
        assertTrue(written, written.contains("ERROR"));
        assertTrue(written, written.contains("IllegalStateException"));
    }

    @Test
    public void aFailureMessageIsSanitizedToo() {
        // An exception message is where a URL or a token most often hides.
        DebugLog.failure("proot failed",
                new IOException("cannot open https://kairema.app/x?token=9f8a7b6c5d4e3f2a1b0c9d8e7f"));
        String written = DebugLog.readAll();
        assertFalse(written, written.contains("kairema.app"));
        assertFalse(written, written.contains("9f8a7b6c5d4e3f2a1b0c9d8e7f"));
    }

    // ---------------------------------------------------------------- read and clear

    @Test
    public void eventsAreAppendedOldestFirst() {
        DebugLog.event("first event");
        DebugLog.event("second event");
        String written = DebugLog.readAll();
        assertTrue(written, written.indexOf("first event") < written.indexOf("second event"));
    }

    @Test
    public void anEventIsTimestamped() {
        DebugLog.event("stamped");
        String written = DebugLog.readAll();
        // HH:mm:ss.SSS at the start of the line.
        assertTrue("expected a timestamp, got: " + written,
                written.matches("(?s)^\\d{2}:\\d{2}:\\d{2}\\.\\d{3} .*"));
    }

    @Test
    public void clearEmptiesTheLog() {
        DebugLog.event("before clear");
        assertFalse(DebugLog.readAll().isEmpty());
        DebugLog.clear();
        assertEquals(DebugLog.EMPTY, DebugLog.readAll());
    }

    @Test
    public void clearLeavesTheLogUsable() {
        // A cleared log is the state the next failure is read against, so writing must still work.
        DebugLog.clear();
        DebugLog.event("after clear");
        String written = DebugLog.readAll();
        assertTrue(written, written.contains("after clear"));
        assertFalse(written, written.contains("before clear"));
    }

    @Test
    public void readingAMissingFileIsNotAnError() {
        assertTrue(logFile.delete());
        assertEquals(DebugLog.EMPTY, DebugLog.readAll());
    }

    @Test
    public void readingWithoutATargetSaysSo() {
        DebugLog.initForTest(null);
        assertEquals("(diagnostics not initialised)", DebugLog.readAll());
        assertFalse(DebugLog.isEnabled());
    }

    @Test
    public void clearWithoutATargetIsHarmless() {
        DebugLog.initForTest(null);
        DebugLog.clear();
        DebugLog.event("dropped");
    }
}