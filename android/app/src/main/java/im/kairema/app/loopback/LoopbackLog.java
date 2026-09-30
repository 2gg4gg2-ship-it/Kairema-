package im.kairema.app.loopback;

/**
 * Minimal logging seam for {@link LoopbackHttpCore}.
 *
 * <p>The core deliberately has no Android dependency so it can also be driven on a plain JVM. This
 * interface keeps that property: {@link JavaLoopbackServer} installs an {@code android.util.Log}
 * backed implementation, while the default is a no-op.
 *
 * <p>Implementations must never receive the upstream host, the loopback credential, cookies,
 * tokens or request bodies. Callers in this package only ever pass the loopback port and lifecycle
 * state.
 */
public interface LoopbackLog {

    /** Used when no platform logger is available, such as on a plain JVM. */
    LoopbackLog NO_OP = new LoopbackLog() {
        @Override
        public void info(String message) {
            // Intentionally empty.
        }

        @Override
        public void warn(String message, Throwable error) {
            // Intentionally empty.
        }
    };

    void info(String message);

    void warn(String message, Throwable error);
}
