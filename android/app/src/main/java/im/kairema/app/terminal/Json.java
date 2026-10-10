package im.kairema.app.terminal;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A minimal JSON writer and a small strict reader for flat objects.
 *
 * <p>The reader exists only to parse the two request bodies the local terminal API accepts
 * ({@code {"data":"..."}} and {@code {}}). A full JSON implementation is not needed and is not
 * linked: the loopback transport already has {@code org.json} available, but pulling it in here
 * would make the terminal package depend on the platform, and these are the only shapes the API
 * has to accept, so accepting only those is also a small amount of validation.
 */
public final class Json {

    private Json() {
    }

    // ---------------------------------------------------------------- writing

    /**
     * Serialises a flat string map as a JSON object.
     *
     * <p>Values are escaped, so terminal output containing quotes, newlines, backslashes or
     * control characters is transported verbatim. That is the whole reason output is not passed as
     * raw lines: a shell can and does emit bytes that would break a line-oriented format.
     */
    public static String writeObject(Map<String, String> fields) {
        StringBuilder out = new StringBuilder(64);
        out.append('{');
        boolean first = true;
        for (Map.Entry<String, String> field : fields.entrySet()) {
            if (!first) {
                out.append(',');
            }
            first = false;
            writeString(out, field.getKey());
            out.append(':');
            if (field.getValue() == null) {
                out.append("null");
            } else {
                writeString(out, field.getValue());
            }
        }
        out.append('}');
        return out.toString();
    }

    /** A frame with a single {@code data} field, the common stdout/stderr case. */
    public static String frame(String type, String data) {
        Map<String, String> fields = new LinkedHashMap<>(2);
        fields.put("type", type);
        fields.put("data", data);
        return writeObject(fields);
    }

    /**
     * The terminal's final frame, carrying the process exit status.
     *
     * <p>Hand-built rather than routed through {@link #writeObject} because the exit status is a JSON
     * number, not a string. The generic writer only emits string values, and a client that had to
     * parse the status back out of a string would be strictly worse.
     */
    public static String exitFrame(int code) {
        return "{\"type\":\"exit\",\"code\":" + code + "}";
    }

    private static void writeString(StringBuilder out, String value) {
        out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                case '\b':
                    out.append("\\b");
                    break;
                case '\f':
                    out.append("\\f");
                    break;
                default:
                    if (c < 0x20 || c == 0x7f) {
                        // Other control bytes, including NUL, are escaped numerically so a frame
                        // stays on one line whatever the program wrote.
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append('"');
    }

    // ---------------------------------------------------------------- reading

    /** Thrown when a request body is not a flat JSON object this API accepts. */
    public static final class MalformedJsonException extends Exception {
        public MalformedJsonException(String message) {
            super(message);
        }
    }

    /**
     * Parses a flat JSON object of string values.
     *
     * <p>Rejects nesting, non-string values, duplicate keys, trailing content and unterminated
     * strings. A body that is not an object is an error rather than an empty map, so a client that
     * sends the wrong shape gets told instead of silently starting a session with no input.
     */
    public static Map<String, String> readFlatObject(String text) throws MalformedJsonException {
        Map<String, String> result = new LinkedHashMap<>();
        if (text == null) {
            throw new MalformedJsonException("no body");
        }
        Cursor cursor = new Cursor(text);
        cursor.skipWhitespace();
        cursor.expect('{');
        cursor.skipWhitespace();
        if (cursor.peek() == '}') {
            cursor.advance();
            cursor.skipWhitespace();
            cursor.expectEnd();
            return result;
        }
        while (true) {
            cursor.skipWhitespace();
            String key = cursor.readString();
            cursor.skipWhitespace();
            cursor.expect(':');
            cursor.skipWhitespace();
            String value = cursor.readString();
            if (result.containsKey(key)) {
                throw new MalformedJsonException("duplicate key");
            }
            result.put(key, value);
            cursor.skipWhitespace();
            char next = cursor.peek();
            if (next == ',') {
                cursor.advance();
                continue;
            }
            if (next == '}') {
                cursor.advance();
                cursor.skipWhitespace();
                cursor.expectEnd();
                return result;
            }
            throw new MalformedJsonException("expected , or }");
        }
    }

    private static final class Cursor {
        private final String text;
        private int at;

        Cursor(String text) {
            this.text = text;
        }

        char peek() throws MalformedJsonException {
            if (at >= text.length()) {
                throw new MalformedJsonException("unexpected end of body");
            }
            return text.charAt(at);
        }

        void advance() {
            at++;
        }

        void skipWhitespace() {
            while (at < text.length()) {
                char c = text.charAt(at);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                    at++;
                } else {
                    return;
                }
            }
        }

        void expect(char expected) throws MalformedJsonException {
            if (at >= text.length() || text.charAt(at) != expected) {
                throw new MalformedJsonException("unexpected character");
            }
            at++;
        }

        void expectEnd() throws MalformedJsonException {
            if (at != text.length()) {
                throw new MalformedJsonException("trailing content after the object");
            }
        }

        String readString() throws MalformedJsonException {
            expect('"');
            StringBuilder out = new StringBuilder();
            while (true) {
                if (at >= text.length()) {
                    throw new MalformedJsonException("unterminated string");
                }
                char c = text.charAt(at++);
                if (c == '"') {
                    return out.toString();
                }
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                if (at >= text.length()) {
                    throw new MalformedJsonException("unterminated escape");
                }
                char escape = text.charAt(at++);
                switch (escape) {
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    case '/': out.append('/'); break;
                    case 'n': out.append('\n'); break;
                    case 'r': out.append('\r'); break;
                    case 't': out.append('\t'); break;
                    case 'b': out.append('\b'); break;
                    case 'f': out.append('\f'); break;
                    case 'u': {
                        if (at + 4 > text.length()) {
                            throw new MalformedJsonException("truncated unicode escape");
                        }
                        String hex = text.substring(at, at + 4);
                        try {
                            out.append((char) Integer.parseInt(hex, 16));
                        } catch (NumberFormatException notHex) {
                            throw new MalformedJsonException("invalid unicode escape");
                        }
                        at += 4;
                        break;
                    }
                    default:
                        throw new MalformedJsonException("invalid escape");
                }
            }
        }
    }
}
