package im.kairema.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The Volume Up + Volume Down hold that opens the debug diagnostics screen.
 *
 * <p>This runs on a plain JVM because the class has no Android imports at all: no {@code KeyEvent}
 * constant and no {@code SystemClock}. Time is passed in, so every timing rule below is checked
 * exactly rather than approximated with sleeps. That is the reason the class is written this way.
 *
 * <p>What is being protected is the user's ability to change the volume on the phone they are
 * diagnosing, so the cases that matter most are the ones where a gesture must <em>not</em> fire.
 */
public class DiagnosticsGestureTest {

    private static final long T0 = 1_000_000L;

    private static boolean up(DiagnosticsGesture gesture, long now) {
        return gesture.onDown(true, false, now);
    }

    private static boolean down(DiagnosticsGesture gesture, long now) {
        return gesture.onDown(false, true, now);
    }

    // ---------------------------------------------------------------- threshold

    @Test
    public void firesExactlyWhenTheHoldCompletes() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse("one key is not a gesture", up(gesture, T0));
        assertFalse("both keys are down but the hold has barely started",
                down(gesture, T0 + 100L));
        assertFalse("just short of the threshold",
                gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS - 1L));
        assertTrue("the hold completed", gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
    }

    @Test
    public void theHoldIsMeasuredFromTheFirstKeyNotTheSecond() {
        // Volume up held for four seconds before volume down joins: the pair has still been held
        // together for four seconds, so it fires at once. Requiring 1.5s from the second key press
        // would make the gesture feel broken to anyone who presses them in the natural order.
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(up(gesture, T0));
        assertFalse(gesture.poll(T0 + 4_000L));
        assertTrue(down(gesture, T0 + 4_000L));
    }

    @Test
    public void theOrderOfTheTwoKeysDoesNotMatter() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(down(gesture, T0));
        assertFalse(up(gesture, T0 + 10L));
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
    }

    @Test
    public void reportsHowLongIsLeft() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertEquals(0L, gesture.remainingMillis(T0));
        up(gesture, T0);
        assertEquals(0L, gesture.remainingMillis(T0));
        down(gesture, T0 + 200L);
        assertEquals(DiagnosticsGesture.HOLD_MILLIS - 200L,
                gesture.remainingMillis(T0 + 200L));
        assertEquals(0L, gesture.remainingMillis(T0 + 10_000L));
    }

    @Test
    public void isArmedOnlyWhileBothKeysAreDown() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(gesture.isArmed());
        up(gesture, T0);
        assertFalse("one key alone is not armed", gesture.isArmed());
        down(gesture, T0 + 10L);
        assertTrue(gesture.isArmed());
        gesture.onUp(false, true, T0 + 20L);
        assertFalse(gesture.isArmed());
    }

    // ---------------------------------------------------------------- one trigger per hold

    @Test
    public void firesOnceForOneHold() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
        // Key repeat, further polls, anything: the same hold cannot fire again.
        assertFalse(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS + 1L));
        assertFalse(gesture.poll(T0 + 60_000L));
        assertFalse("a repeated key-down must not re-arm the gesture",
                gesture.onDown(true, false, T0 + 60_001L));
        assertFalse(gesture.onDown(true, true, T0 + 60_002L));
        assertTrue(gesture.isTriggered());
    }

    @Test
    public void firesAgainOnlyAfterBothKeysAreReleasedAndReset() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));

        // Both keys up ends the hold; reset is what lets the next one fire.
        gesture.onUp(true, false, T0 + 2_000L);
        gesture.onUp(false, true, T0 + 2_100L);
        gesture.reset();
        assertFalse(gesture.isTriggered());
        assertFalse(gesture.isArmed());

        assertFalse(up(gesture, T0 + 10_000L));
        assertFalse(down(gesture, T0 + 10_010L));
        // The second hold is timed from the moment the pair became complete, which is the up key.
        assertFalse(gesture.poll(T0 + 10_000L + DiagnosticsGesture.HOLD_MILLIS - 1L));
        assertTrue(gesture.poll(T0 + 10_000L + DiagnosticsGesture.HOLD_MILLIS));
    }

    @Test
    public void releasingOneKeyLeavesNoStaleArmedState() {
        // Without this, a gesture that fired and was never reset would keep looking armed after both
        // keys were gone, and one later key press could then satisfy the both-keys condition.
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
        gesture.onUp(true, false, T0 + 2_000L);
        gesture.onUp(false, true, T0 + 2_100L);
        assertFalse(gesture.isArmed());

        gesture.reset();
        // A single key afterwards must never open the screen.
        assertFalse(up(gesture, T0 + 10_000L));
        assertFalse(gesture.poll(T0 + 60_000L));
    }

    // ---------------------------------------------------------------- a single key never fires

    @Test
    public void aSingleKeyNeverFires() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(up(gesture, T0));
        assertFalse(gesture.poll(T0 + 30_000L));
        assertFalse(gesture.poll(T0 + 600_000L));
        assertFalse("repeats do not arm it either", up(gesture, T0 + 600_001L));
        assertFalse(gesture.isTriggered());
    }

    @Test
    public void aSingleKeyHeldWhileTheOtherTapsDoesNotFire() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(up(gesture, T0));
        // Volume down tapped repeatedly, never held long enough to pair up with the held key.
        for (long at = T0 + 100L; at < T0 + 5_000L; at += 200L) {
            assertFalse(down(gesture, at));
            gesture.onUp(false, true, at);
        }
        assertFalse(gesture.poll(T0 + 6_000L));
    }

    @Test
    public void aKeyOutsideThePairIsIgnored() {
        // Back, home and menu arrive through the same callback; none of them may arm anything.
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(gesture.onDown(false, false, T0));
        assertFalse(gesture.poll(T0 + 30_000L));
        assertFalse(gesture.isArmed());
        assertFalse(gesture.onUp(false, false, T0 + 30_001L));
    }

    // ---------------------------------------------------------------- release cancels

    @Test
    public void releaseBeforeTheThresholdCancelsTheGesture() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        assertFalse(up(gesture, T0));
        assertFalse(down(gesture, T0 + 1_400L));
        gesture.onUp(false, true, T0 + 1_450L);
        // The hold was a fraction of a second short; letting go of the second key ends the attempt.
        assertFalse(gesture.poll(T0 + 30_000L));
        assertFalse(gesture.isTriggered());
    }

    @Test
    public void releaseAfterTheThresholdDoesNotUntrigger() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
        gesture.onUp(false, true, T0 + 1_600L);
        assertTrue("the screen is already open", gesture.isTriggered());
    }

    @Test
    public void aNewPairIsTimedFromWhenItBecameComplete() {
        // Volume up stays down; volume down is released and pressed again. The second attempt must be
        // measured from the second press, not from the original one, or it would fire instantly.
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        gesture.onUp(false, true, T0 + 500L);
        assertFalse(down(gesture, T0 + 600L));
        assertFalse("the clock restarted when the pair became complete again",
                gesture.poll(T0 + 1_100L));
        assertTrue(gesture.poll(T0 + 2_100L));
    }

    @Test
    public void resetClearsEverything() {
        DiagnosticsGesture gesture = new DiagnosticsGesture();
        up(gesture, T0);
        down(gesture, T0 + 10L);
        assertTrue(gesture.poll(T0 + DiagnosticsGesture.HOLD_MILLIS));
        gesture.reset();
        assertFalse(gesture.isTriggered());
        assertFalse(gesture.isArmed());
        assertEquals(0L, gesture.remainingMillis(T0 + 60_000L));
    }

    @Test
    public void theThresholdIsTheDocumentedOneAndAHalf() {
        assertEquals(1_500L, DiagnosticsGesture.HOLD_MILLIS);
    }
}