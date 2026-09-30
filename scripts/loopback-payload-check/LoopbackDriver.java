package im.kairema.app.loopback.payloadcheck;

import im.kairema.app.loopback.LoopbackHttpCore;
import im.kairema.app.loopback.LoopbackLog;
import im.kairema.app.loopback.LoopbackStaticSource;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.net.URL;

/**
 * Driver for the loopback payload check. Compiled and launched by {@code scripts/loopback-payload-check.mjs}
 * against the real {@link LoopbackHttpCore} sources, so what it exercises is exactly what ships in the APK.
 *
 * <p>Starts the loopback origin pointed at a local upstream, prints the bound port and the access
 * cookie on stdout, and then blocks on stdin until the harness closes it.
 */
public final class LoopbackDriver {

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: LoopbackDriver <upstreamPort>");
            System.exit(2);
        }
        URL upstream = new URL("http://127.0.0.1:" + Integer.parseInt(args[0]));

        LoopbackStaticSource noAssets = relative -> null;
        LoopbackLog log = new LoopbackLog() {
            @Override
            public void info(String message) {
                System.out.println("[loopback] " + message);
                System.out.flush();
            }

            @Override
            public void warn(String message, Throwable error) {
                System.out.println("[loopback-warn] " + message);
                System.out.flush();
            }
        };

        LoopbackHttpCore server = new LoopbackHttpCore(noAssets, upstream, log);
        server.start();

        System.out.println("PORT=" + server.getPort());
        System.out.println("COOKIE=" + server.getAccessCookie());
        System.out.flush();

        InputStream in = new BufferedInputStream(System.in);
        while (in.read() != -1) {
            // Drain until the harness closes stdin.
        }
        server.stop();
        System.out.flush();
    }
}
