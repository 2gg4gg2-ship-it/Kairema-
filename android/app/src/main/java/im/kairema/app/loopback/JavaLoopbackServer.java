package im.kairema.app.loopback;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

/**
 * Android binding for the loopback origin.
 *
 * <p>All HTTP behaviour lives in {@link LoopbackHttpCore}, which has no Android dependency. This
 * class only supplies the bundled files from {@code assets/public} and delegates the lifecycle, so a
 * future Ktor transport can replace the core without changing this file or the WebView wiring.
 */
public final class JavaLoopbackServer implements LoopbackServer {

    private final LoopbackHttpCore core;

    public JavaLoopbackServer(AssetManager assets, String assetsPrefix, URL upstream) {
        this.core = new LoopbackHttpCore(new AssetSource(assets, assetsPrefix), upstream);
    }

    @Override
    public void start() throws IOException {
        core.start();
    }

    @Override
    public void stop() {
        core.stop();
    }

    @Override
    public int getPort() {
        return core.getPort();
    }

    @Override
    public String getOrigin() {
        return core.getOrigin();
    }

    @Override
    public String getAccessCookie() {
        return core.getAccessCookie();
    }

    /** Reads bundled web files out of the APK's assets. */
    private static final class AssetSource implements LoopbackStaticSource {

        private final AssetManager assets;
        private final String prefix;

        AssetSource(AssetManager assets, String prefix) {
            this.assets = assets;
            this.prefix = prefix.endsWith("/") ? prefix : prefix + "/";
        }

        @Override
        public byte[] read(String relativePath) {
            try (InputStream in = assets.open(prefix + relativePath)) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int count;
                while ((count = in.read(chunk)) != -1) {
                    buffer.write(chunk, 0, count);
                }
                return buffer.toByteArray();
            } catch (IOException missing) {
                return null;
            }
        }
    }
}