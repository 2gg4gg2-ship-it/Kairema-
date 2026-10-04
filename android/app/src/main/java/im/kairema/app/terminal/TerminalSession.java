package im.kairema.app.terminal;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import im.kairema.app.loopback.DebugLog;

/**
 * One {@code proot} process: a shell, its stdin, and a stream of output frames.
 *
 * <p>Isolated from the HTTP transport on purpose. This class knows nothing about sockets, cookies or
 * routes; it only turns a byte stream into frames and a frame queue into stdin.
 *
 * <h2>Environment</h2>
 * The child starts from a cleared environment. Only {@code PATH}, {@code HOME}, {@code TERM} and
 * {@code LD_LIBRARY_PATH} are set. In particular the loopback access secret is never inherited:
 * {@link ProcessBuilder} does not pass the parent environment unless it is asked to, so a
 * credential that exists in the app process cannot reach the shell.
 *
 * <h2>Back pressure</h2>
 * Output is drained on reader threads into a bounded queue. When the queue is full the readers stop
 * reading, which stops the pipe, which makes the child block on write: the shell slows down rather
 * than the app allocating memory without limit. Frames are dropped only once the queue is
 * saturated, and the drop is reported to the client as a truncation marker, so output is never
 * silently lost.
 */
public final class TerminalSession {

    /** Maximum bytes buffered per stream before the client is told output was truncated. */
    static final int MAX_BUFFERED_FRAMES = 512;

    /** Hard ceiling on a single session, so a forgotten session cannot hold a process forever. */
    static final long MAX_LIFETIME_MILLIS = 30L * 60L * 1000L;

    /** How long a graceful termination is given before the process is killed. */
    private static final long GRACEFUL_KILL_MILLIS = 2_000L;

    private static final int READ_BUFFER = 4096;

    /** Wall-clock budget for one diagnostic probe run, and the gap between polls while it reads. */
    private static final long PROBE_BUDGET_MILLIS = 4_000L;
    private static final long PROBE_POLL_MILLIS = 25L;
    private static final int MAX_PROBE_CHARS = 4000;

    private final String id;
    private final BlockingQueue<String> frames = new ArrayBlockingQueue<>(MAX_BUFFERED_FRAMES);
    private final List<Thread> readers = new ArrayList<>();
    private final AtomicBoolean truncated = new AtomicBoolean();
    private final long createdAt = System.currentTimeMillis();
    private final Process process;
    private final OutputStream stdin;

    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile boolean exitReported;
    private volatile int exitCode = -1;

    /** Bytes the caller has written to the shell. Zero means the user never typed anything. */
    private final java.util.concurrent.atomic.AtomicLong stdinBytes =
            new java.util.concurrent.atomic.AtomicLong();

    /**
     * The child's stderr, captured only while nothing had been written to its stdin yet.
     *
     * <p>That condition is what makes this safe to record. A shell that is starting has produced no
     * user input, so its output can only be the loader, proot or the shell itself complaining, and
     * those messages are the only way to tell "proot ran and could not exec the shell" apart from
     * "proot never ran". Once anything is written to stdin the capture stops permanently, so no
     * typed command and none of its output can ever reach the log.
     */
    private final StringBuilder startupStderr = new StringBuilder();

    private static final int MAX_STARTUP_STDERR_CHARS = 400;

    TerminalSession(String id, TerminalRuntime runtime) throws IOException {
        this.id = id;
        this.process = launch(runtime);
        this.stdin = process.getOutputStream();
        startReader("kairema-term-out", process.getInputStream(), "stdout");
        startReader("kairema-term-err", process.getErrorStream(), "stderr");
        startReaper();
    }

    /**
     * Records what the guest is actually going to be handed, immediately before the exec.
 *
 * <p>proot reports a failure to start the shell as a single {@code execve("/bin/sh")} line, which
 * does not say which part of the chain was wrong: the path proot was pointed at, a link that did not
 * resolve, or the loader the binary asked for. Each of those produces the same line from proot, so
 * the only way to tell them apart is to write down the chain while it is still observable here.
 *
 * <p>Everything recorded is a path, a permission or an environment variable this class just chose.
 * The argv is a fixed vector and the environment is cleared and rebuilt above, so neither can carry
 * a command, a token or a credential.
 */
private static void logLaunchPreconditions(TerminalRuntime runtime, File executable,
            java.util.Map<String, String> environment, List<String> guestArgv) {
        File rootfs = runtime.getRootfsDir();
        File binDirectory = new File(rootfs, "bin");
        File sh = new File(binDirectory, "sh");
        File busybox = new File(binDirectory, "busybox");
        File loader = new File(rootfs, "lib/ld-musl-aarch64.so.1");
        DebugLog.event("terminal session launch preconditions"
                + "; proot=" + executable.getAbsolutePath()
                + "; prootCanExecute=" + executable.canExecute()
                // What proot was actually asked to run, so the log identifies which guest command
                // produced whatever comes next. Fixed paths only; no user input reaches this vector.
                + "; guestArgv=" + guestArgv
                + "; rootfs=" + rootfs.getAbsolutePath()
                + "; rootfsIsDirectory=" + rootfs.isDirectory()
                + "; binIsDirectory=" + binDirectory.isDirectory()
                + "; sh=" + sh.getAbsolutePath()
                + "; shExists=" + sh.exists()
                + "; shIsSymlink=" + java.nio.file.Files.isSymbolicLink(sh.toPath())
                + "; shLinkTarget=" + linkTarget(sh)
                + "; shLinkTargetResolvesOnHost=" + new File(binDirectory, "busybox").exists()
                + "; busyboxExists=" + busybox.exists()
                + "; busyboxCanExecute=" + busybox.canExecute()
                + "; busyboxBytes=" + (busybox.isFile() ? busybox.length() : -1L)
                + "; loaderExists=" + loader.isFile()
                + "; loaderCanExecute=" + loader.canExecute()
                + "; TMPDIR=" + environment.get("TMPDIR")
                + "; PROOT_TMP_DIR=" + environment.get("PROOT_TMP_DIR")
                + "; PROOT_LOADER=" + environment.get("PROOT_LOADER")
                + "; PROOT_VERBOSE=" + environment.get("PROOT_VERBOSE")
                + "; LD_LIBRARY_PATH=" + environment.get("LD_LIBRARY_PATH")
                + hostExecutionFacts(runtime));
    }

    /**
     * What the host side of the guest boundary actually looks like for proot's two host-side needs:
     * a loader to exec and a writable temporary directory.
     *
     * <p>These are recorded because proot reports a failure to start the guest as one
     * {@code execve("/bin/sh")} line, and that line names the guest program rather than either of the
     * host-side things it actually needs. Whether the compiled-in Termux loader path is reachable from
     * this app, and whether proot's temporary directory can really be written, are the two facts that
     * separate "the rootfs is wrong" from "proot could not run", and neither is visible in proot's own
     * output.
     *
     * <p>{@code canExecute} on a path under another app's data directory is expected to be false:
     * this app has no permission to traverse {@code /data/data/com.termux}. Recording it rather than
     * asserting it is what turns that expectation into evidence.
     */
    private static String hostExecutionFacts(TerminalRuntime runtime) {
        StringBuilder facts = new StringBuilder();
        File prootTempDir = runtime.getProotTempDir();
        facts.append("; prootTmpDir=").append(prootTempDir.getAbsolutePath())
                .append("; prootTmpDirIsDirectory=").append(prootTempDir.isDirectory())
                .append("; prootTmpDirCanWrite=").append(prootTempDir.canWrite())
                .append("; prootTmpDirRealPath=").append(realPath(prootTempDir))
                .append("; prootTempFileProbe=").append(probeTempFile(prootTempDir));

        // The literal that is compiled into this proot build, and the Termux prefix it points at. proot
        // does not check that either exists before exec()ing it, so what matters is reachability.
        String nativeDir = runtime.nativeLibraryDirForDiagnostics();
        facts.append("; nativeLibraryDir=").append(nativeDir);
        for (String compiledIn : new String[] {
                "/data/data/com.termux/files/usr/libexec/proot/loader",
                "/data/data/com.termux/files/usr/libexec/proot/loader32",
                "/data/data/com.termux/files/usr/tmp/",
        }) {
            File path = new File(compiledIn);
            facts.append("; compiledIn[").append(compiledIn)
                    .append("]exists=").append(path.exists())
                    .append(",canRead=").append(path.canRead())
                    .append(",canExecute=").append(path.canExecute())
                    .append(",parentExists=").append(path.getParentFile() != null
                            && path.getParentFile().exists());
        }
        return facts.toString();
    }

    /** The canonical path, or a marker when the path does not resolve. */
    private static String realPath(File file) {
        try {
            return file.getCanonicalPath();
        } catch (IOException | RuntimeException unresolved) {
            return "(unresolved)";
        }
    }

    /**
     * Creates and deletes one file in @param directory, reporting what happened.
     *
     * <p>This is the question proot's own "Please set PROOT_TMP_DIR env. variable to an alternate
     * location (with write permission)." diagnostic asks about, answered directly instead of inferred
     * from whether proot complains. The file is removed immediately, so the directory is left as it
     * was found.
     */
    private static String probeTempFile(File directory) {
        File probe = new File(directory, "kairema-tmp-probe-" + System.nanoTime());
        try {
            if (!probe.createNewFile()) {
                return "not-created(already-exists)";
            }
            return "created+bytes=" + probe.length() + ",deleted=" + probe.delete();
        } catch (IOException | RuntimeException failed) {
            probe.delete();
            return "failed(" + failed.getClass().getSimpleName() + ")";
        }
    }

    /** The text a link points at, or a marker when the path is not a link or cannot be read. */
    private static String linkTarget(File file) {
        try {
            return java.nio.file.Files.readSymbolicLink(file.toPath()).toString();
        } catch (java.io.IOException | RuntimeException notALink) {
            return "(not-a-symlink)";
        }
    }

    private static Process launch(TerminalRuntime runtime) throws IOException {
        DebugLog.event("terminal session launch started; runtimeReady=" + runtime.isReady());
        if (!runtime.isReady()) {
            throw new IOException("terminal runtime is not installed");
        }

        List<String> command = new ArrayList<>();
        File executable = runtime.getProotLaunchBinary();
        command.add(executable.getAbsolutePath());
        // -r: the guest root. -w: the starting directory. -i 0:0: present the current user as root
        // inside the guest, which the extracted rootfs needs because its files belong to uid 0.
        //
        // This used to be spelled "-0". That spelling is ambiguous in this proot build: it carries a
        // --root-id long option, and it also carries the text "Alias: -0 -r *path* + a couple of
        // recommended -b.", which describes an option that takes a path. Under that reading "-0
        // /bin/sh" swallows the command as the guest root, which is exactly the shape of the failure
        // this replaces. "-i 0:0" states the same thing the binary itself documents ("Note that the
        // -0 option is the same as -i 0:0") and cannot be mistaken for the command.
        command.add("-r");
        command.add(runtime.getRootfsDir().getAbsolutePath());
        command.add("-w");
        command.add(TerminalRuntime.GUEST_HOME);
        command.add("-i");
        command.add("0:0");
        // DIAGNOSTIC EXPERIMENT, NOT A FIX. The device reported execve("/bin/sh") = ENOENT while
        // logging shIsSymlink=true, shLinkTarget=/bin/busybox, busyboxExists=true,
        // busyboxCanExecute=true, loaderExists=true. That leaves one question this run answers:
        // whether proot fails only on the symlink, or on the target it points at as well.
        //
        // "/bin/busybox" names a real file inside the guest, so it bypasses the symlink entirely.
        // If the shell starts, the symlink was the problem; if this fails the same way, the problem
        // is underneath the symlink and the experiment has located it. Do not read a success here
        // as a design: it bypasses /bin/sh, and /bin/sh is what the product should run.
        List<String> guestArgv = new ArrayList<>(2);
        guestArgv.add("/bin/busybox");
        guestArgv.add("sh");
        command.addAll(guestArgv);

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(executable.getParentFile());
        builder.redirectErrorStream(false);

        // A cleared environment. Only what a shell needs is set, so no loopback secret, API key or
        // provider credential that exists in the app process can be read from inside the shell.
        java.util.Map<String, String> environment = builder.environment();
        environment.clear();
        environment.put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        environment.put("HOME", TerminalRuntime.GUEST_HOME);
        environment.put("TERM", "xterm-256color");
        environment.put("TMPDIR", "/tmp");
        // Read by proot before the guest exists. The Termux build's compiled-in default does not
        // exist in this app; see TerminalRuntime.getProotTempDir.
        environment.put("PROOT_TMP_DIR", runtime.getProotTempDir().getAbsolutePath());
        String libraryPath = String.join(":", runtime.getLibraryPath());
        if (!libraryPath.isEmpty()) {
            // Needed because proot's own RUNPATH points at the Termux prefix, which does not exist
            // in this app, and because libtalloc.so.2 is staged in an app-private directory.
            environment.put("LD_LIBRARY_PATH", libraryPath);
        }

        logLaunchPreconditions(runtime, executable, environment, guestArgv);

        // DIAGNOSTIC, NOT A FIX. proot does not exec() the guest program: it replaces the execve target
        // with a loader of its own, and reports any failure of that execve as execve("<guest program>").
        // That is why a failure to run the loader is indistinguishable, in proot's output, from a
        // missing /bin/busybox.
        //
        // PROOT_VERBOSE is raised so proot narrates its own decisions, and PROOT_LOADER is pointed at a
        // path in this app's own sandbox for one extra run. Nothing about the rootfs, the guest argv or
        // the architecture changes between the two runs; the only difference is which path proot is
        // told to exec.
        //
        // What each outcome means:
        //   probe[env-as-session] fails with ENOENT on /bin/busybox, and probe[loader-is-a-directory]
        //   fails with EACCES on the same /bin/busybox line, then the execve that is failing is the one
        //   using PROOT_LOADER, not the guest binary. That is the whole diagnosis.
        //   If both probes report ENOENT, the loader path is not what fails and the guest ELF is.
        runProotProbe("env-as-session", runtime, command, environment, null);
        runProotProbe("loader-is-a-directory", runtime, command, environment,
                loaderProbeTarget(runtime));

        // The proot options are not logged: they repeat the rootfs and library paths already recorded
        // above. The guest argv is, because which guest command was tried is the one fact a reader
        // cannot infer from the paths.
        try {
            Process started = builder.start();
            // The pid is not logged: java.lang.Process.pid() does not exist in android.jar, so
            // calling it does not compile against this module's Android API level. The fact that
            // start() returned is the signal that matters; which pid the platform assigned is not
            // needed to tell a broken runtime from a shell that ran.
            DebugLog.event("terminal session ProcessBuilder.start succeeded; execSource="
                    + (runtime.usesPlatformProot() ? "nativeLibDir" : "filesDir"));
            return started;
        } catch (IOException failed) {
            // PROOT_START_FAILED: the process was never created, so nothing about the guest was even
            // attempted. The message carries the platform's own errno ("error=13, Permission denied"
            // means the exec was refused, "Cannot run program" with a load failure means the linker
            // rejected it), which is the whole diagnosis and cannot be reconstructed later.
            DebugLog.failure("terminal session PROOT_START_FAILED", failed);
            throw failed;
        }
    }

    /**
     * A path proot can be told to exec that is guaranteed to fail with a different errno than "absent".
     *
     * <p>{@code execve} of a directory fails with {@code EACCES}, never {@code ENOENT}, so pointing
     * {@code PROOT_LOADER} at one turns "which path failed" into a question the error text answers. It
     * is deliberately not a file: a non-existent file would produce the same {@code ENOENT} as the
     * real failure and prove nothing.
     */
    private static String loaderProbeTarget(TerminalRuntime runtime) {
        File directory = new File(runtime.getRuntimeDir(), "loader-probe-directory");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            DebugLog.event("terminal session loader probe directory could not be created");
            return null;
        }
        return directory.getAbsolutePath();
    }

    /**
     * Runs proot once with @param prootLoader added to the environment, records everything it printed,
     * and kills it if it outlives the budget.
     *
     * <p>stdout and stderr are merged so the ordering proot chose is preserved in the log. stdin is
     * closed immediately, which is what makes a shell that did start exit instead of waiting forever.
     * Nothing is written to the guest and nothing is left behind: proot only reads the rootfs.
     */
    private static void runProotProbe(String label, TerminalRuntime runtime, List<String> command,
            java.util.Map<String, String> sessionEnvironment, String prootLoader) {
        Process probe = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(runtime.getProotLaunchBinary().getParentFile());
            builder.redirectErrorStream(true);
            java.util.Map<String, String> environment = builder.environment();
            environment.clear();
            environment.putAll(sessionEnvironment);
            // 2 is the level at which proot narrates path decisions rather than only errors.
            environment.put("PROOT_VERBOSE", "2");
            if (prootLoader != null) {
                environment.put("PROOT_LOADER", prootLoader);
            }
            probe = builder.start();
            probe.getOutputStream().close();
            DebugLog.event("terminal session probe " + label + " started; PROOT_LOADER=" + prootLoader
                    + "; PROOT_VERBOSE=2; cwd=" + builder.directory().getAbsolutePath());
            StringBuilder captured = new StringBuilder();
            readForBudget(probe.getInputStream(), captured);
            DebugLog.event("terminal session probe " + label + " output: " + collapse(captured));
        } catch (IOException | RuntimeException probeFailed) {
            DebugLog.failure("terminal session probe " + label + " failed", probeFailed);
        } finally {
            if (probe != null) {
                probe.destroyForcibly();
            }
        }
    }

    /** Reads @param source until EOF or the budget is spent, so a hung probe cannot block a session. */
    private static void readForBudget(InputStream source, StringBuilder sink) {
        long deadline = System.currentTimeMillis() + PROBE_BUDGET_MILLIS;
        byte[] buffer = new byte[READ_BUFFER];
        try {
            while (System.currentTimeMillis() < deadline && sink.length() < MAX_PROBE_CHARS) {
                int available = source.available();
                if (available <= 0) {
                    // Nothing buffered: either the child is producing output or it is gone. Either way
                    // a short pause is enough to tell, and keeps this bounded rather than blocking.
                    Thread.sleep(PROBE_POLL_MILLIS);
                    continue;
                }
                int read = source.read(buffer, 0, Math.min(buffer.length, available));
                if (read == -1) {
                    return;
                }
                sink.append(new String(buffer, 0, read, java.nio.charset.StandardCharsets.UTF_8));
            }
        } catch (IOException ended) {
            // The pipe closed, which is how a failing proot ends. Nothing to add.
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    /** One line per probe: newlines in proot's output would otherwise break the log's framing. */
    private static String collapse(StringBuilder text) {
        String flat = text.toString().replaceAll("\\s+", " ").trim();
        return flat.isEmpty() ? "(no output)" : flat;
    }

    private void startReader(String name, InputStream source, String type) {
        final boolean captureStartupStderr = "stderr".equals(type);
        Thread thread = new Thread(() -> {
            byte[] buffer = new byte[READ_BUFFER];
            try {
                int read;
                while ((read = source.read(buffer)) != -1) {
                    if (captureStartupStderr && stdinBytes.get() == 0L) {
                        synchronized (startupStderr) {
                            int room = MAX_STARTUP_STDERR_CHARS - startupStderr.length();
                            if (room > 0) {
                                startupStderr.append(new String(buffer, 0,
                                        Math.min(read, room),
                                        java.nio.charset.StandardCharsets.UTF_8));
                            }
                        }
                    }
                    if (!emit(Json.frame(type, new String(buffer, 0, read,
                            java.nio.charset.StandardCharsets.UTF_8)))) {
                        // Queue is full: the reader stops, the pipe fills and the child blocks.
                        truncated.set(true);
                        return;
                    }
                }
            } catch (IOException closed) {
                // The stream ends when the process exits or the pipe is closed; normal.
            } finally {
                try {
                    source.close();
                } catch (IOException ignored) {
                    // Nothing useful to do while tearing down.
                }
            }
        }, name);
        thread.setDaemon(true);
        readers.add(thread);
        thread.start();
    }

    /** Emits a frame, waiting briefly for room. False when the queue stayed full. */
    private boolean emit(String frame) {
        try {
            frames.offer(frame, 200, TimeUnit.MILLISECONDS);
            return true;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void startReaper() {
        Thread thread = new Thread(() -> {
            int code = -1;
            try {
                code = process.waitFor();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally {
                closeStdin();
                drainRemaining();
                exitCode = code;
                exitReported = true;
                // The exit code and the age of the session: enough to tell "the shell ran and exited"
                // from "proot died at once", which is the difference between a broken runtime and a
                // shell the user typed exit into. No output and no command line is recorded.
                DebugLog.event("terminal session process exited; exitCode=" + code
                        + "; ageMillis=" + getAgeMillis());
                if (stdinBytes.get() == 0L) {
                    // SHELL_START_FAILED. The process was created but died before the user typed
                    // anything, so this is proot or /bin/sh refusing to start, not a session that ran.
                    // Whatever is on stderr at that point is the loader or the shell's own complaint.
                    String captured;
                    synchronized (startupStderr) {
                        captured = startupStderr.toString().trim();
                    }
                    DebugLog.failure("terminal session SHELL_START_FAILED; exitCode=" + code
                            + "; stderr=" + oneLine(captured), null);
                }
                // The exit frame is emitted last and unconditionally, so a client that stops reading
                // at exit still sees the status.
                frames.offer(Json.exitFrame(code));
            }
        }, "kairema-term-reap");
        thread.setDaemon(true);
        readers.add(thread);
        thread.start();
    }

    /**
     * Waits briefly for output already sitting in the pipes and flushes it as frames.
     *
     * <p>Without this, output written immediately before exit can be lost, because the child closed
     * its stdout while bytes were still in flight.
     */
    private void drainRemaining() {
        for (Thread reader : readers) {
            if (reader.getName().startsWith("kairema-term-")) {
                try {
                    reader.join(200);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    // ---------------------------------------------------------------- input

    /**
     * Writes raw bytes to the shell's stdin.
     *
     * <p>The data is passed through unchanged, including a trailing newline, so a caller can send
     * {@code echo hi\n} or a bare {@code ^C}. It is flushed but not logged anywhere.
     */
    public void writeInput(byte[] data) throws IOException {
        if (closed.get()) {
            throw new IOException("session is closed");
        }
        stdin.write(data);
        stdin.flush();
        // Counted before anything can be read back, and never reset: from this point on the startup
        // capture is closed for good, which is what keeps typed input out of the diagnostics log.
        stdinBytes.addAndGet(data.length);
    }

    /** Collapses a captured message to one line so a log entry stays readable. */
    private static String oneLine(String text) {
        String flattened = text.replaceAll("\\s+", " ").trim();
        return flattened.isEmpty() ? "(empty)" : flattened;
    }

    // ---------------------------------------------------------------- output

    /**
     * Takes the next frame, waiting up to {@code timeoutMillis}.
     *
     * @return the frame, or null when nothing arrived in time
     */
    public String pollFrame(long timeoutMillis) throws InterruptedException {
        // A truncation notice is synthetic: it must be delivered even if the queue is full, so it
        // goes in through the normal path with a short wait.
        return frames.poll(timeoutMillis, TimeUnit.MILLISECONDS);
    }

    /** Whether the process has exited and its exit frame has been queued. */
    public boolean hasExited() {
        return exitReported;
    }

    public int getExitCode() {
        return exitCode;
    }

    public String getId() {
        return id;
    }

    public long getAgeMillis() {
        return System.currentTimeMillis() - createdAt;
    }

    boolean isClosed() {
        return closed.get();
    }

    boolean isTruncated() {
        return truncated.get();
    }

    /** Whether the session has exceeded the maximum lifetime. */
    public boolean hasExpired() {
        return getAgeMillis() > MAX_LIFETIME_MILLIS;
    }

    // ---------------------------------------------------------------- shutdown

    /**
     * Stops the process: stdin is closed, then a TERM is sent, then a kill if it is still alive.
     *
     * <p>Called on explicit kill, on session replacement and on app teardown, so a session cannot
     * outlive the app and leave an orphan proot behind. Idempotent.
     */
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        closeStdin();
        process.destroy();
        try {
            if (!process.waitFor(GRACEFUL_KILL_MILLIS, TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                process.waitFor(GRACEFUL_KILL_MILLIS, TimeUnit.MILLISECONDS);
            }
        } catch (InterruptedException interrupted) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
        }
        for (Thread reader : readers) {
            if (reader.getName().startsWith("kairema-term-")) {
                reader.interrupt();
            }
        }
    }

    private void closeStdin() {
        try {
            stdin.close();
        } catch (IOException ignored) {
            // The process may already have exited, which closes the pipe anyway.
        }
    }
}
