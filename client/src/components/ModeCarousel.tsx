import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * One compact, swipeable control that pages between the app's modes.
 *
 * <p>Only the current mode is shown. The alternative, three buttons in a row, does not fit a phone:
 * the row already shares its line with the provider and model controls, so the third label either
 * wraps or crowds them. Here the width of the control is the width of the longest single label and
 * does not change with the mode, so nothing around it moves or reflows when the mode changes.
 *
 * <p>The mode pages are positioned by a CSS variable rather than by React state, which is what lets
 * a drag follow the finger without re-rendering the chat underneath on every pointer move.
 */

export interface ModeDescriptor {
  id: string;
  label: string;
  /** Rendered inside the visible page. Kept as a node so each mode can pick its own icon. */
  icon: React.ReactNode;
}

export interface ModeCarouselLabels {
  group: string;
  previous: string;
  next: string;
  position: (index: number, total: number) => string;
}

export default function ModeCarousel({
  modes,
  value,
  onChange,
  labels,
}: {
  modes: readonly ModeDescriptor[];
  value: string;
  onChange: (next: string) => void;
  labels: ModeCarouselLabels;
}) {
  const total = modes.length;
  const index = Math.max(
    0,
    modes.findIndex((mode) => mode.id === value),
  );

  const step = (delta: number) => {
    const target = index + delta;
    // Clamped rather than wrapping: the ends are the ends, and a wrap makes the direction of the
    // last page ambiguous while swiping.
    if (target < 0 || target >= total) return;
    onChange(modes[target].id);
  };

  return (
    <div className="kairema-mode-carousel" role="group" aria-label={labels.group}>
      <button
        type="button"
        className="kairema-mode-arrow"
        aria-label={labels.previous}
        title={labels.previous}
        data-testid="mode-previous"
        disabled={index === 0}
        onClick={() => step(-1)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>

      <div
        className="kairema-mode-carousel-viewport"
        data-testid="mode-carousel-viewport"
        // The index drives the page offset. Reading it here keeps the transform a single source of
        // truth for both the settled position and the live drag, which combine in CSS.
        style={{ "--kairema-mode-index": index } as React.CSSProperties}
      >
        {/* The control is sized by this hidden stack rather than by a `ch` estimate of the labels.
            Every label is laid out here at its real width in the real font, one per line, so the box
            is exactly as wide as the widest of them and no wider. A `ch` figure is only an
            approximation of a digit's advance and has no relation to a Cyrillic label, which clipped
            «Терминал» and left the shorter modes looking padded. The sizer sits in the same grid cell
            as the track, so it sets the width and the track is laid over it rather than beside it. */}
        <div className="kairema-mode-carousel-sizer" aria-hidden="true" data-testid="mode-carousel-sizer">
          {modes.map((mode) => (
            <span className="kairema-mode-page-label" key={mode.id}>
              {mode.icon}
              <span>{mode.label}</span>
            </span>
          ))}
        </div>
        <div className="kairema-mode-carousel-track">
          {modes.map((mode, modeIndex) => {
            const current = modeIndex === index;
            return (
              <div
                className="kairema-mode-page"
                key={mode.id}
                data-mode={mode.id}
                aria-hidden={!current}
                data-current={current ? "true" : undefined}
              >
                <span
                  className="kairema-mode-option kairema-mode-page-label"
                  data-testid={current ? "mode-current" : undefined}
                  // Only the current page is reachable by keyboard or a screen reader; the others are
                  // visual neighbours at fixed offsets, not separate controls.
                  tabIndex={current ? 0 : -1}
                >
                  {mode.icon}
                  <span>{mode.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="kairema-mode-arrow"
        aria-label={labels.next}
        title={labels.next}
        data-testid="mode-next"
        disabled={index === total - 1}
        onClick={() => step(1)}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>

      {/* Announces the page for assistive tech without moving focus or changing the control size. */}
      <span className="sr-only" role="status" aria-live="polite">
        {labels.position(index, total)}
      </span>
    </div>
  );
}