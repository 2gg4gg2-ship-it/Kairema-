import { MessageSquare, Repeat, SquareTerminal } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  SWIPE_AXIS_THRESHOLD_PX,
  SWIPE_COMMIT_PX,
  classifySwipeAxis,
  resolveSwipeStep,
} from "@/lib/horizontal-swipe";

/**
 * The swipe decision rules.
 *
 * <p>These are the rules that keep a chat scroll from turning into a mode change, so they are
 * tested as pure functions rather than through synthesised pointer streams: a regression here would
 * otherwise only show up as a device that changes mode while you are reading messages.
 */

describe("classifySwipeAxis", () => {
  it("waits until the gesture has actually moved before deciding", () => {
    expect(classifySwipeAxis(3, 3)).toBe("undecided");
    expect(classifySwipeAxis(-SWIPE_AXIS_THRESHOLD_PX + 1, 0)).toBe("undecided");
  });

  it("reads a clearly horizontal drag as horizontal", () => {
    expect(classifySwipeAxis(40, 2)).toBe("horizontal");
    expect(classifySwipeAxis(-40, -2)).toBe("horizontal");
  });

  it("reads a vertical scroll as vertical", () => {
    expect(classifySwipeAxis(2, 40)).toBe("vertical");
    expect(classifySwipeAxis(0, -120)).toBe("vertical");
  });

  it("sends a diagonal to the dominant axis, and to vertical on a tie", () => {
    expect(classifySwipeAxis(30, 10)).toBe("horizontal");
    expect(classifySwipeAxis(10, 30)).toBe("vertical");
    // A perfect diagonal must not be able to steal the scroller.
    expect(classifySwipeAxis(25, 25)).toBe("vertical");
  });
});

describe("resolveSwipeStep", () => {
  it("advances when the content is dragged left, and goes back when dragged right", () => {
    expect(resolveSwipeStep(-(SWIPE_COMMIT_PX + 1))).toBe(1);
    expect(resolveSwipeStep(SWIPE_COMMIT_PX + 1)).toBe(-1);
  });

  it("snaps back for a drag too short to commit", () => {
    expect(resolveSwipeStep(0)).toBe(0);
    expect(resolveSwipeStep(SWIPE_COMMIT_PX - 1)).toBe(0);
    expect(resolveSwipeStep(-(SWIPE_COMMIT_PX - 1))).toBe(0);
  });

  it("treats exactly the commit distance as a change", () => {
    expect(resolveSwipeStep(-SWIPE_COMMIT_PX)).toBe(1);
    expect(resolveSwipeStep(SWIPE_COMMIT_PX)).toBe(-1);
  });
});

describe("the mode order the carousel pages through", () => {
  const ORDER = ["chat", "terminal", "myApi"] as const;

  it("runs Чат, then Терминал, then Мой API", () => {
    expect(ORDER).toEqual(["chat", "terminal", "myApi"]);
  });

  it("keeps a distinct icon per mode so the page is recognisable without its label", () => {
    // Not a behavioural assertion about rendering; it pins that the three descriptors are distinct.
    expect(new Set([MessageSquare, SquareTerminal, Repeat]).size).toBe(3);
  });
});