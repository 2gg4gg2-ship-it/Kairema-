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

    /** Root of the guest filesystem. Used to build proot arguments inside this package. */
    public File getRootfsDir() {
        return rootfsDir;
    }

    /**
     * The app-private directory holding the whole runtime.
     *
     * <p>Exposed for the debug diagnostics screen, which reports whether the directory exists and
     * how much of it is present. Returns the {@link File} and never its path as a string, so a
     * caller that logs what it gets still cannot publish the app's private layout.
     */
    public File getRuntimeDir() {
        return runtimeDir;
    }

    /**
     * Whether the installation marker exists, meaning a previous installation finished.
     *
     * <p>The marker is written only after every file verified, so its absence with {@link #isReady()}
     * false is the normal state before the first use, not a fault.
     */
    public boolean isInstallMarkerPresent() {
        return isMarkedComplete();
    }

    /**
     * Total size of the extracted guest filesystem in bytes, or -1 when it cannot be read.
     *
     * <p>A number and nothing else. The traversal here is the reason the diagnostics screen must not
     * do this on the UI thread: it walks the whole rootfs, which is tens of thousands of entries the
     * first time.
     */
    public long getRootfsSizeBytes() {
        if (!rootfsDir.isDirectory()) {
            return -1L;
        }
        return sizeOfTree(rootfsDir);
    }

    private static long sizeOfTree(File file) {
        long total = 0L;
        File[] children = file.listFiles();
        if (children == null) {
            // Unreadable directory: the size of this one entry is all that can be said.
            return file.length();
        }
        for (File child : children) {
            total += child.isDirectory() && !isSymbolicLink(child)
                    ? sizeOfTree(child)
                    : child.length();
        }
        return total;
    }

    File getHomeDir() {
        return homeDir;
    }

    File getTmpDir() {
        return tmpDir;
    }

    /** The extracted proot binary in the app's own files directory. */
    File getProotBinary() {
        return new File(binDir, "proot");
    }

    /** Name the platform extracts proot under from {@code lib/}. */
    static final String PLATFORM_PROOT_NAME = "libproot.so";

    /**
     * The proot that is actually executed.
     *
     * <p>Two copies of the same bytes exist on disk, and the order matters.
     *
     * <p>The copy in {@code filesDir} is the one that cannot work on a modern Android. Since API 29
     * an app that targets the platform is denied {@code execve} of a file in its own data directory,
     * so a binary staged there and marked executable still fails to start. The only location an app
     * may execute from is the directory the platform extracts {@code lib/} into, which is why proot
     * is shipped there as well and why {@code useLegacyPackaging=true} is not optional.
     *
     * <p>The platform copy is preferred. The {@code filesDir} copy is still extracted and verified,
     * because it is the one whose digest is pinned, and because it remains the only option on a device
     * where the platform did not extract the library.
     *
     * <p>Integrity of the platform copy rests on the APK signature rather than on a digest: AGP may
     * strip symbols from a {@code jniLibs} entry, so pinning bytes there would reject a binary that is
     * perfectly runnable. The bytes inside the APK are covered by the signature the user already
     * trusts, and the pinned digest is still enforced on the asset copy.
     */
    public File getProotLaunchBinary() {
        File platform = platformProotBinary();
        if (platform != null && platform.isFile() && platform.canExecute()) {
            return platform;
        }
        return getProotBinary();
    }

    /** Whether the executable is taken from the platform-extracted library directory. */
    public boolean usesPlatformProot() {
        return getProotLaunchBinary() != getProotBinary();
    }

    private File platformProotBinary() {
        String nativeDir = nativeLibraryDir();
        return nativeDir == null ? null : new File(nativeDir, PLATFORM_PROOT_NAME);
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
        DebugLog.event("terminal runtime: ensureInstalled called; ready=" + ready
                + "; markerPresent=" + isMarkedComplete() + "; installInFlight=" + hasPendingInstall());
        if (ready) {
            DebugLog.event("terminal runtime: ensureInstalled fast path, already ready");
            return;
        }
        synchronized (this) {
            if (ready) {
                DebugLog.event("terminal runtime: ensureInstalled fast path, became ready");
                return;
            }
            if (pendingInstall != null) {
                DebugLog.event("terminal runtime: installation already in progress, joining it");
                return;
            }
            if (isMarkedComplete() && verifyInstalledFilesQuietly()) {
                DebugLog.event("terminal runtime: marker present and files verified, adopting install");
                ready = true;
                DebugLog.event("terminal runtime: ready=true (adopted existing installation)");
                return;
            }
            DebugLog.event("terminal runtime: install started");
            pendingInstall = installer.submit(this::installBlocking);
        }
    }

    private synchronized boolean hasPendingInstall() {
        return pendingInstall != null;
    }

    /** Waits for any in-flight installation. Used by tests and by the first session. */
    public boolean awaitReady(long timeoutMillis) {
        DebugLog.event("terminal runtime: awaitReady started; timeoutMillis=" + timeoutMillis
                + "; ready=" + ready + "; markerPresent=" + isMarkedComplete());
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            if (ready) {
                DebugLog.event("terminal runtime: awaitReady completed; ready=true");
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
        boolean outcome = ready;
        DebugLog.event("terminal runtime: awaitReady " + (outcome ? "completed" : "timed out")
                + "; ready=" + outcome + "; markerPresent=" + isMarkedComplete());
        return outcome;
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(50);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Creates the runtime directory, turning the one failure mode that has no exception into a
     * diagnosable one.
 *
 * <p>{@link File#mkdirs()} returns false instead of throwing when the platform refuses, which on
 * Android means the SELinux policy or the mount state denied it rather than anything being wrong
 * with the path. {@link SecurityException} is the one case it does raise, and it carries the reason,
 * so it is logged with its type and message instead of being folded into the outer catch that
 * cannot tell a refusal from a bad path.
     *
     * @return true when the directory exists afterwards
     */
    private boolean mkdirRuntimeDir() {
        try {
            runtimeDir.mkdirs();
            return runtimeDir.isDirectory();
        } catch (SecurityException denied) {
            DebugLog.failure("terminal runtime: mkdir refused by the platform; runtimePath="
                    + runtimeDir.getAbsolutePath(), denied);
            return false;
        }
    }

    private void installBlocking() {
        DebugLog.event("terminal runtime: installBlocking started");
        try {
            // A partial installation is never reused. Removing the whole directory first means an
            // interrupted run cannot leave a half-extracted rootfs that a later run would accept.
            DebugLog.event("terminal runtime: install phase remove_previous");
            int removed = deleteRecursively(runtimeDir);
            File runtimeParent = runtimeDir.getParentFile();
            DebugLog.event("terminal runtime: remove_previous finished; deletedEntries=" + removed
                    + "; runtimePath=" + runtimeDir.getAbsolutePath()
                    + "; parentWritable="
                    + (runtimeParent == null ? "no-parent" : String.valueOf(runtimeParent.canWrite()))
                    + "; existsAfterDelete=" + runtimeDir.exists()
                    + "; isDirectoryAfterDelete=" + runtimeDir.isDirectory());

            // mkdirs() answers false both when it could not create the directory and when the
            // directory is already there, so asking it first turned a leftover tree into a
            // "cannot create" report. The two cases are separated here: a directory that is still
            // present is reused, and only a genuine refusal to create is a failure.
            boolean existed = runtimeDir.exists();
            boolean isDirectory = runtimeDir.isDirectory();
            if (existed && !isDirectory) {
                DebugLog.event("terminal runtime: mkdir refused; runtimePath="
                        + runtimeDir.getAbsolutePath() + "; existsBefore=true"
                        + "; isDirectoryBefore=false; reason=path_exists_but_is_a_file");
                fail("install_root", "mkdir_runtime_dir", null);
                return;
            }
            if (!isDirectory && !mkdirRuntimeDir()) {
                DebugLog.event("terminal runtime: mkdir refused; runtimePath="
                        + runtimeDir.getAbsolutePath() + "; existsBefore=" + existed
                        + "; isDirectoryBefore=" + isDirectory
                        + "; existsAfter=" + runtimeDir.exists()
                        + "; isDirectoryAfter=" + runtimeDir.isDirectory()
                        + "; parentWritable="
                        + (runtimeParent == null ? "no-parent" : String.valueOf(runtimeParent.canWrite()))
                        + "; reason=mkdirs_returned_false");
                fail("install_root", "mkdir_runtime_dir", null);
                return;
            }
            DebugLog.event("terminal runtime: install phase runtime_dir_ready");

            installNatives();
            DebugLog.event("terminal runtime: install phase natives_complete");
            installRootfs();
            DebugLog.event("terminal runtime: install phase rootfs_complete");

            // The marker is written only after every file verified, so its presence means the
            // installation is complete.
            DebugLog.event("terminal runtime: marker being written");
            try (FileOutputStream marker = new FileOutputStream(markerFile())) {
                marker.write("1".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            }
            DebugLog.event("terminal runtime: marker written");
            ready = true;
            DebugLog.event("terminal runtime: ready=true");
            Log.i(TAG, "terminal runtime installed and verified");
        } catch (IOException installFailure) {
            // Nothing about the failure detail is propagated: it can contain paths. DebugLog still
            // sanitizes, and only the phase token reaches the file.
            fail("install_failed", "install_io", installFailure);
        } catch (RuntimeException unexpected) {
            fail("install_failed", "install_runtime_exception", unexpected);
        } finally {
            synchronized (this) {
                pendingInstall = null;
            }
        }
    }

    /**
     * Records a failure.
     *
     * <p>The phase is a fixed token chosen at the call site, never an exception message: it says
     * which step stopped, and it cannot carry a path or a digest. The throwable goes to
     * {@link DebugLog#failure(String, Throwable)}, which sanitizes its message and writes no stack
     * trace, so it is useful without ever being able to leak the runtime's layout.
     */
    private void fail(String token, String phase, Throwable error) {
        failure = token;
        ready = false;
        DebugLog.failure("terminal runtime: install failure; phase=" + phase
                + "; failureToken=" + token, error);
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
                && getProotLaunchBinary().isFile()
                && new File(libDir, "libtalloc.so.2").isFile()
                // The executable bit matters as much as the file: an Alpine rootfs extracted without
                // it has a busybox that proot cannot run, and the failure looks like a broken proot.
                && new File(rootfsDir, "bin/busybox").canExecute()
                && new File(rootfsDir, "etc/alpine-release").isFile();
    }

    private void installNatives() throws IOException {
        DebugLog.event("terminal runtime: installNatives started");
        if (!binDir.mkdirs() || !libDir.mkdirs()) {
            throw new IOException("could not create runtime bin/lib");
        }
        DebugLog.event("terminal runtime: proot verification started");
        // proot and libtalloc.so.2: verified, then made executable.
        extractVerifiedAsset(NATIVE_ASSET_DIR + "proot", PROOT_SHA256, getProotBinary(), true);
        DebugLog.event("terminal runtime: proot verification completed");
        DebugLog.event("terminal runtime: libtalloc verification started");
        extractVerifiedAsset(NATIVE_ASSET_DIR + "libtalloc.so.2", LIBTALLOC_SHA256,
                new File(libDir, "libtalloc.so.2"), false);
        DebugLog.event("terminal runtime: libtalloc verification completed");

        // libandroid-shmem.so is packaged in lib/ by AGP, so the platform has already extracted it
        // to nativeLibraryDir. It is only verified here, to keep the digest guarantee complete.
        DebugLog.event("terminal runtime: libandroid-shmem verification started");
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
        DebugLog.event("terminal runtime: libandroid-shmem verification completed");
        DebugLog.event("terminal runtime: platform proot verification started");
        // proot is exec()ed rather than dlopen()ed, so it has to live where the platform extracted
        // lib/. The digest is deliberately not re-checked here; see getProotLaunchBinary.
        File platformProot = platformProotBinary();
        if (platformProot == null || !platformProot.isFile()) {
            DebugLog.event("terminal runtime: platform proot missing, will exec the app files copy");
        } else {
            platformProot.setExecutable(true, true);
            platformProot.setReadable(true, true);
            DebugLog.event("terminal runtime: platform proot verification completed; bytes="
                    + platformProot.length());
        }
        DebugLog.event("terminal runtime: execSource="
                + (usesPlatformProot() ? "nativeLibDir" : "filesDir"));
        DebugLog.event("terminal runtime: installNatives completed");
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
        DebugLog.event("terminal runtime: installRootfs started");
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
        DebugLog.event("terminal runtime: rootfs digest pass started");
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
        DebugLog.event("terminal runtime: rootfs digest pass completed");

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
        DebugLog.event("terminal runtime: installRootfs completed");
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

    /**
     * Whether a directory entry exists, <em>without</em> following a symbolic link.
     *
     * <p>{@link File#exists()} is the wrong question here. It stats the target, so a symlink whose
     * target is missing reports false. The Alpine rootfs is 335 symlinks, and the great majority are
     * absolute inside the guest, pointing at paths such as {@code /bin/busybox} that do not exist on
     * the Android host. Asked with {@code exists()}, every one of them looks absent, so they were
     * never deleted, so the directories holding them were never empty, so the runtime directory could
     * never be removed.
     *
     * @see #deleteRecursively(File)
     */
    private static boolean entryExists(File file) {
        return java.nio.file.Files.exists(file.toPath(),
                java.nio.file.LinkOption.NOFOLLOW_LINKS);
    }

    /**
     * Deletes a tree and reports how much of it went away.
     *
     * <p>Existence is tested with {@link #entryExists(File)}, which does not follow symlinks. That is
     * the whole point: a dangling link is still a directory entry that has to be unlinked, and
     * {@link File#delete()} removes the link itself without touching its target.
     *
     * <p>A failure is counted, not thrown. The caller uses the count to notice a tree it could not
     * clear instead of discovering it later as an unrelated mkdir failure.
     *
     * @return the number of entries deleted
     */
    private static int deleteRecursively(File file) {
        if (file == null || !entryExists(file)) {
            return 0;
        }
        int deleted = 0;
        if (file.isDirectory() && !isSymbolicLink(file)) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : Arrays.asList(children)) {
                    deleted += deleteRecursively(child);
                }
            }
        }
        // delete() unlinks a symlink itself rather than its target, which is exactly what is wanted.
        return file.delete() ? deleted + 1 : deleted;
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
