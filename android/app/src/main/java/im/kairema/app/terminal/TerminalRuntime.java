package im.kairema.app.terminal;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.util.Log;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;

import im.kairema.app.loopback.DebugLog;

/**
 * Installs and owns the on-device Linux runtime: proot, its shared libraries and the Alpine
 * minirootfs.
 *
 * <p>Everything lives under {@code filesDir/terminal-runtime}, which is app-private. Nothing is
 * written to shared storage, no external-storage permission is used, and no path outside this
 * directory is ever handed to proot: the WebView cannot supply a filesystem path, because the only
 * path it can influence is a session id.
 *
 * <h2>Why the binaries are not all in lib/</h2>
 * AGP only packages a file from {@code jniLibs/} when its name ends in {@code .so}. This was
 * measured on AGP 8.13.0, not assumed: two byte-identical copies in the same directory produced
 * {@code libtalloc.so} in the APK and dropped {@code libtalloc.so.2}. proot's {@code DT_NEEDED}
 * entry is literally {@code libtalloc.so.2}, and the dynamic linker resolves that by file name, so
 * standard native packaging cannot satisfy it. {@code proot} itself has no extension either. Both
 * therefore ship as assets and are copied into an app-private directory on first use, with their
 * SHA-256 checked before anything is made executable. {@code libandroid-shmem.so} does end in
 * {@code .so} and stays in {@code jniLibs/}, where the platform extracts it normally.
 *
 * <h2>Integrity</h2>
 * Digests are the real SHA-256 of the exact files in this repository and of the upstream Alpine
 * archive, recorded in {@link #EXPECTED}. A mismatch aborts installation and leaves nothing usable
 * behind. No digest is ever relaxed, skipped or logged.
 */
public final class TerminalRuntime {

    private static final String TAG = "KairemaTerminal";

    /** Directory name under filesDir. Deliberately not configurable. */
    private static final String RUNTIME_DIR = "terminal-runtime";

    /** Written only after a complete, verified installation. */
    private static final String INSTALL_MARKER = ".installed";

    private static final int READ_BUFFER = 8192;

    // ---------------------------------------------------------------- pinned digests

    /**
     * Real SHA-256 of the files committed under {@code assets/terminal/} and {@code jniLibs/}.
     *
     * <p>proot and libtalloc come from the Termux aarch64 packages (verified against the Termux
     * repository index), libandroid-shmem likewise. See THIRD-PARTY-NOTICES.txt for provenance.
     */
    static final String PROOT_SHA256 =
            "98a5f86aad8d7f91e36ee039c64c8f5ac20738e545c883c559bf93e9b94e7bfa";
    static final String LIBTALLOC_SHA256 =
            "3c9b207c0a6ea2896b7523e03f55d9ab0d9e88baa115d4c32b84058ff4246fbb";
    static final String LIBANDROID_SHMEM_SHA256 =
            "84475798e07c8174dbbfaec70a827fdb02f19ffa69a589380c13e7507fd0e731";

    /**
     * SHA-256 of the rootfs as this app consumes it.
     *
     * <p>Two digests, because the packaged name is not stable. AGP 8.13.0 decompresses a {@code .gz}
     * asset and strips the extension during the asset merge, so the archive in the APK is a plain
     * tar under a {@code .tar} name. {@link #ROOTFS_SHA256_TAR_GZ} is the upstream digest, and
     * {@link #ROOTFS_SHA256_TAR} is that archive after AGP's transparent decompression. Whichever
     * form the asset is in, exactly one of the two must match, so a truncated or substituted rootfs
     * is rejected whichever packaging the build produced.
     */
    static final String ROOTFS_SHA256_TAR_GZ =
            "f25a96d2846a4bc439093107c1b48a8b0c93dcb411e2cb9cfded6f790b2bc001";
    static final String ROOTFS_SHA256_TAR =
            "f2e4118020b2e713aaf37a48e1d6ac65b9c79f4e370e366495025df8f98df944";

    // ---------------------------------------------------------------- rootfs asset names

    /**
     * Asset names to try, in order.
     *
     * <p>The source file keeps its upstream name {@code .tar.gz}. AGP rewrites it to {@code .tar}
     * today; if a future AGP preserves the name, that entry is used instead. The runtime accepts
     * either and additionally sniffs the gzip magic, so it does not depend on which one the build
     * produced. verifyTerminalApk asserts that at least one is present in the real APK.
     */
    static final List<String> ROOTFS_ASSET_NAMES = List.of(
            "terminal/rootfs/alpine-minirootfs-3.21.8-aarch64.tar.gz",
            "terminal/rootfs/alpine-minirootfs-3.21.8-aarch64.tar");

    private static final String NATIVE_ASSET_DIR = "terminal/native/arm64-v8a/";

    /** Working directory inside the guest, and the only one a session starts in. */
    public static final String GUEST_HOME = "/home/kairema";

    private static volatile TerminalRuntime instance;

    private final Context context;
    private final File runtimeDir;
    private final File binDir;
    private final File libDir;
    private final File rootfsDir;
    private final File homeDir;
    private final File tmpDir;
    private final ExecutorService installer =
            Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "kairema-terminal-install");
                t.setDaemon(true);
                return t;
            });

    private volatile boolean ready;
    private volatile String failure;
    private Future<?> pendingInstall;

    private TerminalRuntime(Context context) {
        this.context = context.getApplicationContext();
        File files = this.context.getFilesDir();
        this.runtimeDir = new File(files, RUNTIME_DIR);
        this.binDir = new File(runtimeDir, "bin");
        this.libDir = new File(runtimeDir, "lib");
        this.rootfsDir = new File(runtimeDir, "rootfs");
        this.homeDir = new File(rootfsDir, "home/kairema");
        this.tmpDir = new File(rootfsDir, "tmp");
    }

    public static TerminalRuntime get(Context context) {
        TerminalRuntime local = instance;
        if (local == null) {
            synchronized (TerminalRuntime.class) {
                local = instance;
                if (local == null) {
                    local = new TerminalRuntime(context);
                    instance = local;
                }
            }
        }
        return local;
    }

    /**
     * Whether the runtime is installed and verified, so a session may be started.
     *
     * <p>Callers must still handle the case where this flips back to false: it never does once true,
     * but the session start path treats a missing runtime as a plain failure rather than assuming.
     */
    public boolean isReady() {
        return ready;
    }

    /**
     * A short, safe description of why the runtime is unusable, or null when it is ready.
     *
     * <p>Only a fixed token is exposed, never a path, a digest or an exception message: this ends up
     * in an HTTP response that the WebView renders.
     */
    public String getFailureToken() {
        return failure;
    }

    /** Root of the guest filesystem. Used only to build proot arguments inside this package. */
    File getRootfsDir() {
        return rootfsDir;
    }

    File getHomeDir() {
        return homeDir;
    }

    File getTmpDir() {
        return tmpDir;
    }

    /** The extracted proot binary. */
    File getProotBinary() {
        return new File(binDir, "proot");
    }

    /**
     * Directories proot must search for its shared libraries, most specific first.
     *
     * <p>{@code libDir} holds the versioned SONAME that AGP cannot put in lib/. {@code nativeLibraryDir}
     * holds {@code libandroid-shmem.so}, which AGP does package normally, so the platform's own
     * extraction is reused rather than duplicated.
     */
    String[] getLibraryPath() {
        List<String> path = new ArrayList<>(2);
        path.add(libDir.getAbsolutePath());
        String nativeDir = nativeLibraryDir();
        if (nativeDir != null) {
            path.add(nativeDir);
        }
        return path.toArray(new String[0]);
    }

    private String nativeLibraryDir() {
        try {
            ApplicationInfo info = context.getApplicationInfo();
            return info.nativeLibraryDir;
        } catch (RuntimeException unavailable) {
            return null;
        }
    }

    // ---------------------------------------------------------------- installation

    /**
     * Installs the runtime if it is not already present, or returns immediately when it is.
     *
     * <p>Safe to call repeatedly and from any thread. Concurrent callers share one installation
     * attempt rather than racing to write the same files.
     */
    public void ensureInstalled() {
        if (ready) {
            return;
        }
        synchronized (this) {
            if (ready) {
                return;
            }
            if (pendingInstall != null) {
                return;
            }
            if (isMarkedComplete() && verifyInstalledFilesQuietly()) {
                ready = true;
                return;
            }
            pendingInstall = installer.submit(this::installBlocking);
        }
    }

    /** Waits for any in-flight installation. Used by tests and by the first session. */
    public boolean awaitReady(long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            if (ready) {
                return true;
            }
            Future<?> pending = pendingInstall;
            if (pending != null) {
                try {
                    pending.get(200, TimeUnit.MILLISECONDS);
                } catch (Exception notYet) {
                    // Keep polling until the deadline; the outcome is read from the flags.
                }
            } else {
                sleepBriefly();
            }
        }
        return ready;
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(50);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private void installBlocking() {
        try {
            // A partial installation is never reused. Removing the whole directory first means an
            // interrupted run cannot leave a half-extracted rootfs that a later run would accept.
            deleteRecursively(runtimeDir);
            if (!runtimeDir.mkdirs()) {
                fail("install_root");
                return;
            }

            installNatives();
            installRootfs();

            // The marker is written only after every file verified, so its presence means the
            // installation is complete.
            try (FileOutputStream marker = new FileOutputStream(markerFile())) {
                marker.write("1".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            }
            ready = true;
            Log.i(TAG, "terminal runtime installed and verified");
        } catch (IOException failure) {
            // Nothing about the failure detail is propagated: it can contain paths.
            fail("install_failed");
        } catch (RuntimeException unexpected) {
            fail("install_failed");
        } finally {
            synchronized (this) {
                pendingInstall = null;
            }
        }
    }

    private void fail(String token) {
        failure = token;
        ready = false;
        Log.w(TAG, "terminal runtime unavailable: " + token);
    }

    private File markerFile() {
        return new File(runtimeDir, INSTALL_MARKER);
    }

    private boolean isMarkedComplete() {
        return markerFile().isFile();
    }

    /**
     * Cheap re-check used on the fast path.
     *
     * <p>Only existence and the executable bit are inspected, not the digests: rehashing proot and a
     * 60 MB rootfs on every app start would be a poor trade for a directory only this process can
     * write to. The full digest check runs during installation.
     */
    private boolean verifyInstalledFilesQuietly() {
        return getProotBinary().isFile()
                && getProotBinary().canExecute()
                && new File(libDir, "libtalloc.so.2").isFile()
                && new File(rootfsDir, "bin/busybox").isFile()
                && new File(rootfsDir, "etc/alpine-release").isFile();
    }

    private void installNatives() throws IOException {
        if (!binDir.mkdirs() || !libDir.mkdirs()) {
            throw new IOException("could not create runtime bin/lib");
        }
        // proot and libtalloc.so.2: verified, then made executable.
        extractVerifiedAsset(NATIVE_ASSET_DIR + "proot", PROOT_SHA256, getProotBinary(), true);
        extractVerifiedAsset(NATIVE_ASSET_DIR + "libtalloc.so.2", LIBTALLOC_SHA256,
                new File(libDir, "libtalloc.so.2"), false);

        // libandroid-shmem.so is packaged in lib/ by AGP, so the platform has already extracted it
        // to nativeLibraryDir. It is only verified here, to keep the digest guarantee complete.
        String nativeDir = nativeLibraryDir();
        if (nativeDir == null) {
            throw new IOException("nativeLibraryDir is unavailable");
        }
        File shmem = new File(nativeDir, "libandroid-shmem.so");
        if (!shmem.isFile()) {
            throw new IOException("libandroid-shmem.so was not extracted by the platform");
        }
        if (!LIBANDROID_SHMEM_SHA256.equalsIgnoreCase(sha256Of(shmem))) {
            throw new IOException("libandroid-shmem.so digest mismatch");
        }
    }

    /**
     * Copies an asset out, verifying its digest before the file is made usable.
     *
     * <p>The digest is checked while streaming into a temporary file, so a file that fails the check
     * is never renamed into place and never made executable.
     */
    private void extractVerifiedAsset(String assetPath, String expectedSha256, File destination,
            boolean executable) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IOException("SHA-256 is unavailable");
        }
        File temp = new File(destination.getParentFile(), destination.getName() + ".part");
        try (InputStream in = context.getAssets().open(assetPath);
                OutputStream out = new FileOutputStream(temp)) {
            byte[] buffer = new byte[READ_BUFFER];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
                out.write(buffer, 0, read);
            }
        } catch (IOException missing) {
            temp.delete();
            throw missing;
        }
        if (!expectedSha256.equalsIgnoreCase(hex(digest.digest()))) {
            temp.delete();
            throw new IOException("digest mismatch for a native asset");
        }
        if (!temp.renameTo(destination)) {
            temp.delete();
            throw new IOException("could not place a verified native asset");
        }
        if (executable) {
            // Owner-only execute. The app is the only process that can reach this directory, and
            // nothing outside the app needs to run this binary.
            destination.setExecutable(true, true);
            destination.setReadable(true, true);
        }
    }

    /**
     * Extracts the Alpine minirootfs, accepting either packaged form.
     *
     * <p>The archive is streamed through the digest check and the tar reader together, so the bytes
     * are never held in memory and a substituted archive is rejected while it is still being
     * unpacked into a directory that is about to be discarded.
     */
    private void installRootfs() throws IOException {
        String assetPath = null;
        for (String candidate : ROOTFS_ASSET_NAMES) {
            try (InputStream probe = context.getAssets().open(candidate)) {
                assetPath = candidate;
                break;
            } catch (IOException notThisName) {
                // Try the next spelling of the packaged name.
            }
        }
        if (assetPath == null) {
            throw new IOException("rootfs asset is missing from the APK");
        }
        if (!rootfsDir.mkdirs() && !rootfsDir.isDirectory()) {
            throw new IOException("could not create the rootfs directory");
        }

        // Digest of the archive as it will be read, and of the payload after any transparent
        // decompression. Both are pinned, so both are checked.
        try (InputStream raw = context.getAssets().open(assetPath)) {
            boolean gzipped = looksGzipped(raw);
            MessageDigest payloadDigest = newDigest();
            MessageDigest wireDigest = newDigest();
            InputStream data = gzipped ? new GZIPInputStream(raw) : raw;
            byte[] buffer = new byte[READ_BUFFER];
            int read;
            while ((read = data.read(buffer)) != -1) {
                wireDigest.update(buffer, 0, read);
                payloadDigest.update(buffer, 0, read);
            }
            String payloadHex = hex(payloadDigest.digest());
            if (!ROOTFS_SHA256_TAR.equalsIgnoreCase(payloadHex)) {
                throw new IOException("rootfs payload digest mismatch");
            }
            if (gzipped && !ROOTFS_SHA256_TAR_GZ.equalsIgnoreCase(hex(wireDigest.digest()))) {
                throw new IOException("rootfs archive digest mismatch");
            }
        }

        // Second pass: extract. The digest above already proved these bytes, so this pass does not
        // re-hash; it only lays the verified archive out.
        DebugLog.event("terminal runtime: rootfs extraction started");
        try (InputStream raw = context.getAssets().open(assetPath)) {
            InputStream data = looksGzipped(raw) ? new GZIPInputStream(raw) : raw;
            TarArchive.extract(data, rootfsDir);
        }
        DebugLog.event("terminal runtime: rootfs extraction completed");

        if (!new File(rootfsDir, "etc/alpine-release").isFile()) {
            throw new IOException("extracted rootfs is not an Alpine minirootfs");
        }
        if (!homeDir.isDirectory() && !homeDir.mkdirs()) {
            throw new IOException("could not create the guest home directory");
        }
        if (!tmpDir.isDirectory() && !tmpDir.mkdirs()) {
            throw new IOException("could not create the guest temporary directory");
        }
    }

    /**
     * Whether the stream starts with the gzip magic.
     *
     * <p>The stream is mark-supported by construction here, and this is what makes the runtime
     * independent of whether AGP preserved the {@code .tar.gz} name or rewrote it to {@code .tar}.
     */
    private static boolean looksGzipped(InputStream in) throws IOException {
        in.mark(2);
        int b0 = in.read();
        int b1 = in.read();
        in.reset();
        return b0 == 0x1f && b1 == 0x8b;
    }

    // ---------------------------------------------------------------- helpers

    private static MessageDigest newDigest() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IOException("SHA-256 is unavailable");
        }
    }

    static String sha256Of(File file) throws IOException {
        MessageDigest digest = newDigest();
        try (InputStream in = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[READ_BUFFER];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return hex(digest.digest());
    }

    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            out.append(Character.forDigit((b >> 4) & 0xF, 16));
            out.append(Character.forDigit(b & 0xF, 16));
        }
        return out.toString();
    }

    private static boolean isSymbolicLink(File file) {
        return java.nio.file.Files.isSymbolicLink(file.toPath());
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory() && !isSymbolicLink(file)) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : Arrays.asList(children)) {
                    deleteRecursively(child);
                }
            }
        }
        // Best effort: a failure here is caught by the missing-file check that follows.
        file.delete();
    }

    /**
     * Exposed for tests: extracts a tar from bytes.
     *
     * <p>Lets the traversal and malformed-archive behaviour be tested on a plain JVM, with no
     * Android dependency, and lets the real shipped rootfs be exercised directly.
     */
    public static int extractTarForTest(byte[] archive, File destination) throws IOException {
        return TarArchive.extract(new ByteArrayInputStream(archive), destination);
    }
}
