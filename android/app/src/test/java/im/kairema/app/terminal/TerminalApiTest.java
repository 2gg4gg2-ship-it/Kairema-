package im.kairema.app.terminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import im.kairema.app.loopback.LoopbackRoutes;

import java.util.LinkedHashMap;
import java.util.Map;

/** JSON framing, session id shape, and the separation between local and upstream routes. */
public class TerminalApiTest {

    // ---------------------------------------------------------------- session ids

    @Test
    public void newSessionIdsAre128BitsOfHex() {
        String id = TerminalSessions.newSessionId();
        assertEquals("a session id is 32 lowercase hex characters", 32, id.length());
        assertTrue("unexpected characters in " + id, id.matches("^[0-9a-f]{32}$"));
    }

    @Test
    public void newSessionIdsAreNotRepeated() {
        // 256 samples from a 128-bit space: a collision would mean the generator is broken, not unlucky.
        Map<String, Boolean> seen = new LinkedHashMap<>();
        for (int i = 0; i < 256; i++) {
            String id = TerminalSessions.newSessionId();
            assertNull("duplicate session id " + id, seen.put(id, Boolean.TRUE));
        }
    }

    @Test
    public void acceptsOnlyTheExactIdShape() {
        assertTrue(TerminalSessions.isValidSessionId("0123456789abcdef0123456789abcdef"));
        assertFalse(TerminalSessions.isValidSessionId(null));
        assertFalse(TerminalSessions.isValidSessionId(""));
        assertFalse(TerminalSessions.isValidSessionId("short"));
        assertFalse("uppercase hex is not what this server issues",
                TerminalSessions.isValidSessionId("0123456789ABCDEF0123456789ABCDEF"));
        assertFalse(TerminalSessions.isValidSessionId("0123456789abcdef0123456789abcde"));
        assertFalse(TerminalSessions.isValidSessionId("0123456789abcdef0123456789abcdeff"));
        assertFalse("a traversal attempt must never pass the id check",
                TerminalSessions.isValidSessionId("../../etc/passwd0000"));
        assertFalse(TerminalSessions.isValidSessionId("0123456789abcdef0123456789abcdeg"));
    }

    // ---------------------------------------------------------------- json output

    @Test
    public void escapesOutputThatWouldBreakALineOrientedFormat() {
        String frame = Json.frame("stdout", "a\"b\\c\nd\te\r\rf");
        // One line, escaped: no raw newline or quote survives.
        assertFalse("a frame must stay on a single line", frame.contains("\n"));
        assertFalse(frame.contains("\"a\"b\""));
        assertTrue(frame.contains("\\\""));
        assertTrue(frame.contains("\\\\"));
        assertTrue(frame.contains("\\n"));
        assertTrue(frame.contains("\\t"));
    }

    @Test
    public void escapesControlBytesNumerically() {
        String frame = Json.frame("stdout", "a\0b");
        assertTrue("NUL must be escaped, not embedded", frame.contains("\\u0000"));
    }

    @Test
    public void exitFrameCarriesANumericCode() {
        assertEquals("{\"type\":\"exit\",\"code\":0}", Json.exitFrame(0));
        assertEquals("{\"type\":\"exit\",\"code\":137}", Json.exitFrame(137));
    }

    // ---------------------------------------------------------------- json input

    @Test
    public void readsTheInputBody() throws Exception {
        Map<String, String> parsed = Json.readFlatObject("{\"data\":\"echo hi\\n\"}");
        assertEquals("echo hi\n", parsed.get("data"));
    }

    @Test
    public void readsAnEmptyObject() throws Exception {
        assertTrue(Json.readFlatObject("{}").isEmpty());
        assertTrue(Json.readFlatObject("  {  }  ").isEmpty());
    }

    @Test
    public void toleratesInsignificantWhitespace() throws Exception {
        Map<String, String> parsed = Json.readFlatObject("  {\n  \"data\" : \"x\" \n} ");
        assertEquals("x", parsed.get("data"));
    }

    @Test
    public void refusesBodiesThatAreNotFlatStringObjects() {
        assertRefused("not json");
        assertRefused("");
        assertRefused("[]");
        assertRefused("\"a string\"");
        assertRefused("{\"data\":123}");
        assertRefused("{\"data\":{\"nested\":1}}");
        assertRefused("{\"data\":\"a\",\"data\":\"b\"}");
        assertRefused("{\"data\":\"unterminated}");
        assertRefused("{\"data\":\"x\"} trailing");
        assertRefused("{\"data\":\"x\",}");
        assertRefused("{\"data\":\"bad \\q escape\"}");
        assertRefused("{\"data\":\"\\u00zz\"}");
    }

    private static void assertRefused(String body) {
        try {
            Json.readFlatObject(body);
            fail("expected the body to be refused: " + body);
        } catch (Json.MalformedJsonException expected) {
            assertNotNull(expected.getMessage());
        }
    }

    // ---------------------------------------------------------------- route separation

    @Test
    public void terminalRoutesAreNotProxyable() {
        // The single most important property here: a terminal request must never reach the backend.
        String[] localPaths = {
            "/api/local/terminal",
            "/api/local/terminal/",
            "/api/local/terminal/session",
            "/api/local/terminal/status",
            "/api/local/terminal/0123456789abcdef0123456789abcdef/input",
            "/api/local/terminal/0123456789abcdef0123456789abcdef/stream",
            "/api/local/terminal/0123456789abcdef0123456789abcdef/kill",
        };
        for (String path : localPaths) {
            assertFalse("must not be forwarded upstream: " + path,
                    LoopbackRoutes.isProxyable(path));
        }
    }

    @Test
    public void existingProxyRoutesAreUnchanged() {
        // The allowlist is asserted exactly, so adding a local route can never quietly widen it.
        assertEquals(6, LoopbackRoutes.PROXY_ALLOWLIST.size());
        for (String allowed : new String[]{
                "/api/trpc", "/api/chat/stream", "/api/attachments/upload",
                "/api/oauth/callback", "/api/stytch/callback", "/manus-storage/"}) {
            assertTrue("must stay proxyable: " + allowed, LoopbackRoutes.isProxyable(allowed));
        }
    }

    @Test
    public void existingPrefixMatchingIsUnchanged() {
        assertTrue(LoopbackRoutes.isProxyable("/api/trpc/batch/1"));
        assertTrue(LoopbackRoutes.isProxyable("/manus-storage/key"));
        assertFalse("a prefix must not match a longer segment",
                LoopbackRoutes.isProxyable("/api/trpc-evil"));
        assertFalse(LoopbackRoutes.isProxyable("/api/unknown"));
        assertFalse(LoopbackRoutes.isProxyable("/api/local/terminal"));
    }

    @Test
    public void localPrefixesDoNotOverlapTheProxyAllowlist() {
        assertFalse("a local route may not shadow or be shadowed by an upstream one",
                LoopbackRoutes.localPrefixesOverlapProxyAllowlist());
    }

    @Test
    public void localOwnershipCoversExactlyTheTerminalPrefix() {
        assertTrue(TerminalRoutes.ownsPath("/api/local/terminal/session"));
        assertTrue(TerminalRoutes.ownsPath("/api/local/terminal"));
        assertFalse(TerminalRoutes.ownsPath("/api/local/other"));
        assertFalse(TerminalRoutes.ownsPath("/api/trpc"));
        assertFalse(TerminalRoutes.ownsPath("/"));
        assertFalse(TerminalRoutes.ownsPath(null));
    }
}
