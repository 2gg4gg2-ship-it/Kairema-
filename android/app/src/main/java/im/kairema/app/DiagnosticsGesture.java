package im.kairema.app;

/**
 * The Volume Up + Volume Up hold that opens the debug diagnostics screen.
 *
 * <p>Deliberately free of any Android import. {@code KeyEvent} constants and the uptime clock are
 * the caller's business; this class only knows that "a volume key went down" and "a volume key came
 * up". That keeps the timing rules testable on a plain JVM, which is the only way they can be
 * verified without a device.
 *
 * <h2>The rules</h2>
 * <ul>
 *   <li>Both keys must be down at the same time, for {@link #HOLD_MILLIS}.</li>
 *   <li>The hold is measured from the <em>first</em> key of the pair, so the order the two keys are
 *       pressed in does not change how long the gesture takes.</li>
 *   <li>One hold fires once. Repeats, key-up auto-repeat and a re-poll cannot fire it again while
 *       the keys stay down.</li>
 *   <li>Letting go of either key ends the attempt, even after a long press that was a fraction of a
 *       second short.</li>
 *   <li>A single key, however long it is held, never fires.</li>
 * </ul>
 *
 * <h2>Why a hold at all</h2>
 * The user has to be able to raise the volume on a phone. A gesture that opened a diagnostics
 * overlay when the user pressed volume up would be unusable, so this one needs both keys, a hold
 * long enough to be deliberate, and something that is not a control anyone presses by accident.
 *
 * <p>Time comes in as a parameter from {@code SystemClock.uptimeMillis()} on a device and from a
 * literal in a test, so there is no clock to inject and no thread to stop.
 */
public final class DiagnosticsGesture {

    /** How long both volume keys must be held together. */
    public static final long HOLD_MILLIS = 1_500L;

    private boolean volumeUpDown;
    private boolean volumeDownDown;

    /** When the currently held pair began: the down of whichever key came first. */
    private long pressStartedAt;

    private boolean triggered;

    /**
     * Records a key-down.
     *
     * @param volumeUp true when this is the volume up key
     * @param volumeDown true when this is the volume down key
     * @param nowMillis a monotonic uptime reading, in milliseconds
     * @return true exactly once per qualifying hold, on the call that crosses the threshold
     */
    public boolean onDown(boolean volumeUp, boolean volumeDown, long nowMillis) {
        if (triggered || (!volumeUp && !volumeDown)) {
            return false;
        }
        if (!volumeUpDown && !volumeDownDown) {
            // First key of the pair. A repeated down for a key already held must not restart the
            // clock, or holding both keys forever would never fire.
            pressStartedAt = nowMillis;
        }
        volumeUpDown |= volumeUp;
        volumeDownDown |= volumeDown;
        return evaluate(nowMillis);
    }

    /**
     * Records a key-up.
     *
     * <p>Never fires: releasing a key is the opposite of the gesture. If the other key is still
     * down the clock restarts from now, so a second hold is measured from the moment the pair
     * became complete again.
     *
     * @return always false
     */
    public boolean onUp(boolean volumeUp, boolean volumeDown, long nowMillis) {
        // The key state is updated even after the gesture has fired: leaving it stale would keep the
        // gesture looking armed once both keys were gone, and the next single key press could then
        // satisfy the both-keys condition without a hold.
        volumeUpDown &= !volumeUp;
        volumeDownDown &= !volumeDown;
        if (volumeUpDown || volumeDownDown) {
            pressStartedAt = nowMillis;
        } else {
            pressStartedAt = 0L;
        }
        return false;
    }

    /**
     * Re-evaluates the hold without a key event, for the caller that schedules a check instead of
     * relying on key repeat.
     *
     * @return true exactly once per qualifying hold
     */
    public boolean poll(long nowMillis) {
        return evaluate(nowMillis);
    }

    /** Whether both keys are currently down. */
    public boolean isArmed() {
        return volumeUpDown && volumeDownDown;
    }

    /** Whether this hold has already fired. */
    public boolean isTriggered() {
        return triggered;
    }

    /**
     * How much longer the keys must stay down, or zero if the threshold is already met.
     *
     * <p>Used to schedule a single check at the moment the gesture becomes due, so the screen opens
     * when the hold completes rather than whenever the next key event happens to arrive.
     */
    public long remainingMillis(long nowMillis) {
        if (triggered || !isArmed()) {
            return 0L;
        }
        long remaining = HOLD_MILLIS - (nowMillis - pressStartedAt);
        return remaining > 0L ? remaining : 0L;
    }

    /**
     * Forgets everything, so the next hold can fire again.
     *
     * <p>Called once both keys are released, and when the screen closes.
     */
    public void reset() {
        volumeUpDown = false;
        volumeDownDown = false;
        pressStartedAt = 0L;
        triggered = false;
    }

    /**
     * The one decision, in one place: armed, past the threshold, and not fired yet.
     *
     * <p>{@code fired} is only ever cleared by {@link #reset()}, which is what makes "once per hold"
     * hold no matter how often the caller polls.
     */
    private boolean evaluate(long nowMillis) {
        if (triggered || !isArmed()) {
            return false;
        }
        if (nowMillis - pressStartedAt < HOLD_MILLIS) {
            return false;
        }
        triggered = true;
        return true;
    }
}