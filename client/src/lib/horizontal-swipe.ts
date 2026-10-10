/**
 * Horizontal swipe recognition for the mode carousel.
 *
 * <p>Kept separate from the carousel component because the part that actually goes wrong is the
 * decision logic, not the rendering: a gesture that is really a vertical scroll of the chat must
 * never change the mode. Both functions here are pure, so that decision is testable without
 * synthesising a stream of pointer events.
 *
 * <p>The gesture is resolved in two steps. The axis is decided first, from the first movement that
 * exceeds the threshold, and only then is a commit considered. Once the axis is vertical the
 * gesture is abandoned outright: the chat keeps scrolling and no mode change is possible.
 */

/** "undecided" means the gesture has not moved far enough to tell the axes apart yet. */
export type SwipeAxis = "undecided" | "horizontal" | "vertical";

/** Movement needed before the gesture is attributed to an axis. Below this, it could be either. */
export const SWIPE_AXIS_THRESHOLD_PX = 10;

/** Travel needed to commit a mode change. Short of this the carousel snaps back. */
export const SWIPE_COMMIT_PX = 48;

/**
 * Which axis a gesture belongs to.
 *
 * <p>Diagonal gestures resolve to the dominant axis, and a tie resolves to vertical, because a chat
 * that fails to scroll is worse than a swipe that needs to be slightly longer.
 */
export function classifySwipeAxis(dx: number, dy: number, threshold: number = SWIPE_AXIS_THRESHOLD_PX): SwipeAxis {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < threshold && absY < threshold) return "undecided";
  return absX > absY ? "horizontal" : "vertical";
}

/**
 * Which mode a released gesture moves to.
 *
 * <p>Dragging the content to the left (dx negative) advances, matching the carousel's own
 * direction of travel. Returns 0 when the gesture is too short, which means snap back rather than
 * change.
 */
export function resolveSwipeStep(dx: number, commit: number = SWIPE_COMMIT_PX): -1 | 0 | 1 {
  if (dx <= -commit) return 1;
  if (dx >= commit) return -1;
  return 0;
}

import * as React from "react";

export interface SwipeHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
}

export interface UseHorizontalSwipeOptions {
  onNext: () => void;
  onPrevious: () => void;
  /**
   * Live drag offset in pixels, and 0 once the gesture ends.
   *
   * <p>Reported through a callback rather than state on purpose: the handlers sit on the surface
   * that contains the chat, so re-rendering the page on every pointermove would make the gesture
   * janky on a phone. The carousel applies the offset to a CSS variable instead.
   */
  onDrag?: (offsetPx: number) => void;
  axisThreshold?: number;
  commit?: number;
  disabled?: boolean;
}

/**
 * Wires pointer events for one horizontal swipe gesture.
 *
 * <p>Only the primary pointer starts a gesture, so a pinch or a second finger cannot move the mode.
 * A gesture that ends before the axis is decided, which is a tap or a long press, changes nothing:
 * long-press to select text in the chat keeps working because selecting involves no travel.
 */
export function useHorizontalSwipe({
  onNext,
  onPrevious,
  onDrag,
  axisThreshold = SWIPE_AXIS_THRESHOLD_PX,
  commit = SWIPE_COMMIT_PX,
  disabled = false,
}: UseHorizontalSwipeOptions): SwipeHandlers {
  const gesture = React.useRef<{ id: number; startX: number; startY: number; axis: SwipeAxis } | null>(null);

  const finish = React.useCallback(() => {
    gesture.current = null;
    onDrag?.(0);
  }, [onDrag]);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (disabled || !event.isPrimary) return;
      // A non-primary button is a context-menu or selection gesture, not a swipe.
      if (event.button !== 0) return;
      gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, axis: "undecided" };
    },
    [disabled],
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (current.axis === "undecided") {
        current.axis = classifySwipeAxis(dx, dy, axisThreshold);
        if (current.axis === "undecided") return;
        if (current.axis === "vertical") {
          // Hand the gesture back to the scroller permanently; only the axis decision is made once.
          finish();
          return;
        }
      }
      if (current.axis !== "horizontal") return;
      onDrag?.(dx);
    },
    [axisThreshold, finish, onDrag],
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) {
        finish();
        return;
      }
      const step = current.axis === "horizontal" ? resolveSwipeStep(event.clientX - current.startX, commit) : 0;
      finish();
      if (step === 1) onNext();
      else if (step === -1) onPrevious();
    },
    [commit, finish, onNext, onPrevious],
  );

  const onPointerCancel = React.useCallback(() => finish(), [finish]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}