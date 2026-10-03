package im.kairema.app.terminal;

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

    TerminalSession(String id, TerminalRuntime runtime) throws IOException {
        this.id = id;
        this.process = launch(runtime);
        this.stdin = process.getOutputStream();
        startReader("kairema-term-out", process.getInputStream(), "stdout");
        startReader("kairema-term-err", process.getErrorStream(), "stderr");
        startReaper();
    }

    private static Process launch(TerminalRuntime runtime) throws IOException {
        DebugLog.event("terminal session launch started; runtimeReady=" + runtime.isReady());
        if (!runtime.isReady()) {
            throw new IOException("terminal runtime is not installed");
        }

        List<String> command = new ArrayList<>();
        command.add(runtime.getProotBinary().getAbsolutePath());
        // -r: the guest root. -w: the starting directory. -0: a new session, so a signal raised
        // inside the shell cannot reach the app process.
        command.add("-r");
        command.add(runtime.getRootfsDir().getAbsolutePath());
        command.add("-w");
        command.add(TerminalRuntime.GUEST_HOME);
        command.add("-0");
        command.add("/bin/sh");

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(runtime.getProotBinary().getParentFile());
        builder.redirectErrorStream(false);

        // A cleared environment. Only what a shell needs is set, so no loopback secret, API key or
        // provider credential that exists in the app process can be read from inside the shell.
        java.util.Map<String, String> environment = builder.environment();
        environment.clear();
        environment.put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        environment.put("HOME", TerminalRuntime.GUEST_HOME);
        environment.put("TERM", "xterm-256color");
        environment.put("TMPDIR", "/tmp");
        String libraryPath = String.join(":", runtime.getLibraryPath());
        if (!libraryPath.isEmpty()) {
            // Needed because proot's own RUNPATH points at the Termux prefix, which does not exist
            // in this app, and because libtalloc.so.2 is staged in an app-private directory.
            environment.put("LD_LIBRARY_PATH", libraryPath);
        }

        // The argument vector and the environment are deliberately not logged: the command is a
        // fixed argv and the environment holds absolute app-private paths.
        try {
            Process started = builder.start();
            // The pid is not logged: java.lang.Process.pid() does not exist in android.jar, so
            // calling it does not compile against this module's Android API level. The fact that
            // start() returned is the signal that matters; which pid the platform assigned is not
            // needed to tell a broken runtime from a shell that ran.
            DebugLog.event("terminal session ProcessBuilder.start succeeded");
            return started;
        } catch (IOException failed) {
            DebugLog.failure("terminal session ProcessBuilder.start failed", failed);
            throw failed;
        }
    }

    private void startReader(String name, InputStream source, String type) {
        Thread thread = new Thread(() -> {
            byte[] buffer = new byte[READ_BUFFER];
            try {
                int read;
                while ((read = source.read(buffer)) != -1) {
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
