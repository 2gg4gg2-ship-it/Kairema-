package im.kairema.app.loopback;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Builds the {@link LoopbackServer} from the generated Capacitor configuration.
 *
 * <p>The upstream is read from {@code assets/capacitor.config.json}, which is produced from
 * {@code capacitor.config.ts}. It has no committed default: the build is expected to supply
 * {@code KAIREMA_API_BASE_URL}. When it is missing the shell refuses to start the proxy rather than
 * falling back to some guessed host, so a misconfigured build cannot silently ship.
 */
public final class LoopbackServerFactory {

    private static final String TAG = "KairemaLoopback";
    private static final String CONFIG_ASSET = "capacitor.config.json";
    private static final String PLUGIN_ID = "KairemaLoopback";

    private LoopbackServerFactory() {
    }

    public static LoopbackServer create(AssetManager assets) throws IOException {
        String apiBaseUrl = readApiBaseUrl(assets);
        if (apiBaseUrl == null || apiBaseUrl.trim().isEmpty()) {
            throw new IOException(
                    "Loopback upstream is not configured. Build the APK with KAIREMA_API_BASE_URL set.");
        }
        URL upstream = new URL(apiBaseUrl.trim());
        // The upstream carries session cookies and chat traffic, so it must be TLS. Plaintext here
        // would also change the SameSite/Secure attributes the backend issues.
        if (!"https".equalsIgnoreCase(upstream.getProtocol())) {
            throw new IOException("Loopback upstream must be https, got: " + upstream.getProtocol());
        }
        return new JavaLoopbackServer(assets, "public", upstream);
    }

    private static String readApiBaseUrl(AssetManager assets) throws IOException {
        byte[] raw;
        try (InputStream in = assets.open(CONFIG_ASSET)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            raw = buffer.toByteArray();
        }
        JSONObject root;
        try {
            root = new JSONObject(new String(raw, StandardCharsets.UTF_8));
        } catch (JSONException malformed) {
            // The generated config is supposed to be valid JSON. If it is not, the build or the
            // sync step went wrong, and there is no upstream to recover, so refuse to start the
            // loopback server exactly as an unset apiBaseUrl would.
            throw new IOException(
                    CONFIG_ASSET + " is not valid JSON; the Capacitor config was not generated correctly.",
                    malformed);
        }
        JSONObject plugins = root.optJSONObject("plugins");
        if (plugins == null) {
            return null;
        }
        JSONObject loopback = plugins.optJSONObject(PLUGIN_ID);
        return loopback == null ? null : loopback.optString("apiBaseUrl", null);
    }

    /** Logs a startup failure without ever echoing the configured host into the log. */
    public static void logStartupFailure(IOException failure) {
        Log.e(TAG, "Loopback origin could not start: " + failure.getMessage());
    }
}