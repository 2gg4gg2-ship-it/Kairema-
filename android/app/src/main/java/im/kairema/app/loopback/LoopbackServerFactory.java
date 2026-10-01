package im.kairema.app.loopback;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
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
        return create(assets, null);
    }

    /**
     * Builds the loopback server, optionally with a local service.
     *
     * <p>The local service is passed straight into the transport as a routing seam. It is created by
     * the caller rather than here so the terminal runtime can be started and shut down with the
     * activity, and so the upstream configuration path above is not entangled with it.
     */
    public static LoopbackServer create(AssetManager assets, LoopbackLocalService localService)
            throws IOException {
        String apiBaseUrl = readApiBaseUrl(assets);
        if (apiBaseUrl == null || apiBaseUrl.trim().isEmpty()) {
            throw new IOException(
                    "Loopback upstream is not configured. Build the APK with KAIREMA_API_BASE_URL set.");
        }
        Log.i(TAG, "Read apiBaseUrl from " + CONFIG_ASSET + " (value not logged)");
        URL upstream;
        try {
            upstream = new URL(apiBaseUrl.trim());
        } catch (MalformedURLException malformed) {
            // MalformedURLException embeds the offending string in its message, so the cause is not
            // propagated: this message is safe to log and does not reveal the configured host.
            throw new IOException("Loopback upstream is not a valid URL.", malformed);
        }
        // The upstream carries session cookies and chat traffic, so it must be TLS. Plaintext here
        // would also change the SameSite/Secure attributes the backend issues.
        if (!"https".equalsIgnoreCase(upstream.getProtocol())) {
            throw new IOException("Loopback upstream must be https, got: " + upstream.getProtocol());
        }
        return new JavaLoopbackServer(assets, "public", upstream, localService);
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

    /**
     * Whether the build asked for on-device diagnostics.
     *
     * <p>Read from the generated config rather than from a manifest or a debuggable flag, so the
     * value is fixed at build time by {@code KAIREMA_ANDROID_DEBUG=1} and cannot be switched on from
     * the device.
     */
    public static boolean isDebugDiagnosticsEnabled(AssetManager assets) {
        try {
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
            JSONObject root = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            JSONObject plugins = root.optJSONObject("plugins");
            if (plugins == null) {
                return false;
            }
            JSONObject loopback = plugins.optJSONObject(PLUGIN_ID);
            return loopback != null && loopback.optBoolean("debugDiagnostics", false);
        } catch (IOException | JSONException unreadable) {
            // Diagnostics must never be the reason startup fails; default to off.
            return false;
        }
    }

    /**
     * Logs a startup failure without ever echoing the configured host into the log.
     *
     * <p>Only the exception type and message are logged. The throwable itself is deliberately not
     * attached: {@code MalformedURLException} from parsing the upstream includes the offending string
     * in its own message, and a stack trace would print that into logcat.
     */
    public static void logStartupFailure(IOException failure) {
        Log.e(TAG, "Loopback origin could not start: " + failure.getClass().getSimpleName()
                + ": " + failure.getMessage());
    }
}
