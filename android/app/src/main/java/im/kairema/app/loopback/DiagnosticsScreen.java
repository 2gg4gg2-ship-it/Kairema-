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

/**
 * Debug-only fallback shown when the WebView cannot load the loopback origin.
 *
 * <p>The point of this screen is that it must work when the web app is unreachable. It therefore
 * builds plain Android views with no dependency on the bundled HTML, on Capacitor, or on the
 * loopback server being alive. That is the whole reason it exists: the failure it reports is one
 * where the WebView is exactly the thing that is broken.
 *
 * <p>It never offers a remote URL as an escape hatch. Falling back to Render would hide the very
 * failure this is meant to expose.
 */
public final class DiagnosticsScreen {

    private static final int PADDING = 24;

    private final LinearLayout root;
    private final TextView summary;
    private final TextView logView;
    private final Runnable onRetry;

    public DiagnosticsScreen(Context context, String headline, Runnable onRetry) {
        this.onRetry = onRetry;

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

        summary = new TextView(context);
        summary.setText(headline);
        summary.setTextSize(15);
        summary.setTextColor(Color.RED);
        summary.setPadding(0, PADDING / 2, 0, PADDING / 2);
        root.addView(summary, wrapContent());

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
        buttons.addView(button(context, "Copy diagnostics", () -> copy(context)));
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
     * impossible. The overlay is opaque and full-size, so the broken page underneath is not
     * visible, and hiding it puts the WebView back.
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

    /** Re-reads the log file. */
    public void refresh() {
        logView.setText(DebugLog.readAll());
    }

    /** Updates the red state line, e.g. once a retry has started. */
    public void setHeadline(String headline) {
        summary.setText(headline);
    }

    private void copy(Context context) {
        ClipboardManager clipboard =
                (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            Toast.makeText(context, "Clipboard unavailable", Toast.LENGTH_SHORT).show();
            return;
        }
        // DebugLog sanitizes on write, so what is read back here has already had every URL and long
        // token redacted. Nothing else is added on the way out.
        clipboard.setPrimaryClip(ClipData.newPlainText("Kairema diagnostics", DebugLog.readAll()));
        Toast.makeText(context, "Diagnostics copied", Toast.LENGTH_SHORT).show();
    }

    private void retry() {
        setHeadline("Loopback WebView connection failed");
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
