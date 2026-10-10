package im.kairema.app.loopback;

/**
 * Supplies the bundled web files the loopback origin serves.
 *
 * <p>Kept separate from the HTTP logic so the same core runs unchanged on a plain JVM (where the
 * transport spike drives it from a directory) and inside the APK (where the source is backed by
 * {@code AssetManager}).
 */
public interface LoopbackStaticSource {

    /**
     * Returns the bytes of the bundled file at {@code relativePath}, or {@code null} when there is no
     * such file so the caller can fall back to {@code index.html}.
     */
    byte[] read(String relativePath);
}