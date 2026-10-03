package im.kairema.app.loopback;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Debug-only, phone-readable diagnostics for the on-device terminal runtime.
 *
 * <p>The user has no PC, no adb and no logcat. When pressing New Session answers "The Linux runtime is
 * not available yet", the only thing that tells anyone why is a log, and the only place that log can
 * be read is this screen. It is opened deliberately, with a Volume Up + Volume Down hold, from
 * {@code MainActivity}, and exists only in a debuggable build.
 *
 * <p>It builds plain Android views on purpose: it has to keep working when the web app is the thing
 * that is broken, so it depends on no bundled HTML, no Capacitor and no live loopback server.
 *
 * <p>Everything it shows is local. There is no remote URL to fall back to and no retry over the
 * network, because a fallback would hide the very failure this screen exists to expose. The status
 * and the log are read on a background thread, because the runtime status touches the filesystem and
 * a 60 MB rootfs must never be measured on the thread that draws the screen.
 */
public final class DiagnosticsScreen {

    private static final int PADDING = 24;

    /**
     * Supplies the current state of the thing being diagnosed.
     *
     * <p>Called on a background thread, so an implementation may stat files or ask the runtime for
     * its accessors. The returned text is displayed verbatim: it must be a short, fixed-vocabulary
     * summary, never an exception message or a path.
     */
    public interface StatusProvider {
        String status();
    }

    private final Context context;
    private final LinearLayout root;
    private final TextView headlineView;
    private final TextView statusView;
    private final TextView logView;
    private final Runnable onRetry;
    private final StatusProvider statusProvider;

    /**
     * One thread, daemon, so a pending status read cannot keep the process alive.
     *
     * <p>Never shut down: the screen is opened and closed repeatedly, and a read in flight when the
     * overlay goes away posts back to views that are already detached, which is harmless.
     */
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "kairema-diagnostics");
        t.setDaemon(true);
        return t;
    });

    public DiagnosticsScreen(Context context, String headline, Runnable onRetry,
            StatusProvider statusProvider) {
        this.context = context;
        this.onRetry = onRetry;
        this.statusProvider = statusProvider;

        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(PADDING, PADDING, PADDING, PADDING);

        TextView title = new TextView(context);
        title.setText("Kairema Android diagnostics");
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.BLACK);
        root.addView(title, wrapContent());

        TextView summary = new TextView(context);
        summary.setText(headline);
        summary.setTextSize(15);
        summary.setTextColor(Color.RED);
        summary.setPadding(0, PADDING / 2, 0, PADDING / 2);
        root.addView(summary, wrapContent());
        headlineView = summary;

        statusView = new TextView(context);
        statusView.setTextSize(13);
        statusView.setTypeface(Typeface.MONOSPACE);
        statusView.setTextIsSelectable(true);
        statusView.setPadding(0, PADDING / 2, 0, PADDING / 2);
        root.addView(statusView, wrapContent());

        ScrollView scroller = new ScrollView(context);
        logView = new TextView(context);
        logView.setTextSize(11);
        logView.setTextColor(Color.BLACK);
        logView.setTypeface(Typeface.MONOSPACE);
        logView.setTextIsSelectable(true);
        scroller.addView(logView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        root.addView(scroller, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout buttons = new LinearLayout(context);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.START);
        buttons.setPadding(0, PADDING, 0, 0);
        buttons.addView(button(context, "Refresh", () -> refresh()));
        buttons.addView(button(context, "Clear log", () -> clearLog()));
        buttons.addView(button(context, "Copy diagnostics", () -> copy()));
        buttons.addView(button(context, "Retry", () -> retry()));
        root.addView(buttons, wrapContent());

        refresh();
    }

    private static LinearLayout.LayoutParams wrapContent() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private Button button(Context context, String label, Runnable action) {
        Button view = new Button(context);
        view.setText(label);
        view.setAllCaps(false);
        view.setOnClickListener(ignored -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.rightMargin = PADDING;
        view.setLayoutParams(params);
        return view;
    }

    /**
     * Overlays the screen on top of the existing content.
     *
     * <p>The host container also holds the Capacitor layout and its WebView, so nothing here may
     * clear it: removing those views would leave the WebView detached and make a later retry
     * impossible. The overlay is opaque and full-size, so the page underneath is not visible, and
     * hiding it puts the WebView back.
     */
    public void showIn(ViewGroup container) {
        if (root.getParent() == container) {
            container.removeView(root);
        }
        root.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
        container.addView(root);
        refresh();
    }

    public void hideFrom(ViewGroup container) {
        container.removeView(root);
    }

    /**
     * Re-reads the status and the log, off the UI thread.
     *
     * <p>Both reads touch the filesystem: the status walks the runtime directory and the log is a
     * capped file that is rewritten as it is trimmed. Doing either inline would stall the frame the
     * user pressed a button in, so the work is handed to {@link #WORKER} and the result is posted
     * back to the UI thread.
     */
    public void refresh() {
        statusView.setText("Reading status...");
        WORKER.execute(() -> {
            String status = readStatus();
            String log = DebugLog.readAll();
            root.post(() -> {
                statusView.setText(status);
                logView.setText(log);
            });
        });
    }

    /**
     * Empties the local debug log, then re-reads.
     *
     * <p>Deliberately narrow: no runtime files, no installed state, no settings. A user clearing the
     * log wants a clean log for the next failure to be read against, not a reset.
     *
     * <p>The single line written afterwards is the whole record of the clear: written before it, the
     * line would delete itself along with everything else.
     */
    private void clearLog() {
        DebugLog.clear();
        DebugLog.event("diagnostics: log cleared by user");
        refresh();
    }

    /** Reads the provider's status, tolerating a provider that throws. */
    private String readStatus() {
        if (statusProvider == null) {
            return "No status provider installed";
        }
        try {
            String status = statusProvider.status();
            return status == null || status.trim().isEmpty() ? "(no status)" : status;
        } catch (RuntimeException | LinkageError unavailable) {
            // The status is a convenience next to the log, which is the part that actually matters.
            // A provider that cannot answer must not take the screen down with it.
            return "(status unavailable: " + unavailable.getClass().getSimpleName() + ")";
        }
    }

    /** Replaces the red state line, e.g. once a retry has started. */
    public void setHeadline(String headline) {
        headlineView.setText(headline);
    }

    private void copy() {
        ClipboardManager clipboard =
                (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            Toast.makeText(context, "Clipboard unavailable", Toast.LENGTH_SHORT).show();
            return;
        }
        // DebugLog sanitizes on write, so what is read back here has already had every URL, header
        // value and long token redacted. Nothing else is added on the way out.
        clipboard.setPrimaryClip(ClipData.newPlainText("Kairema diagnostics", DebugLog.readAll()));
        Toast.makeText(context, "Diagnostics copied", Toast.LENGTH_SHORT).show();
    }

    private void retry() {
        setHeadline("Retrying");
        DebugLog.event("diagnostics: retry requested by user");
        if (onRetry != null) {
            onRetry.run();
        }
        refresh();
    }

    /** Convenience for callers that need the raw view. */
    public View view() {
        return root;
    }
}
