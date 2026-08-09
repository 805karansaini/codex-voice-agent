export type ResizeBounds = {
  min: number;
  max: number;
};

/**
 * Which arrow key grows the panel. Panels docked on the left grow as the
 * separator moves right; panels docked on the right grow as it moves left.
 */
export type ResizeDirection = "grow-right" | "grow-left";

const STEP_PX = 16;
const COARSE_STEP_PX = 64;

export function clampWidth(value: number, bounds: ResizeBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

/**
 * Maps a keyboard event on a separator to the width the panel should take.
 * Returns `null` when the key is not a resize control, so the caller can leave
 * the event alone.
 */
export function nextResizeWidth(
  current: number,
  key: string,
  direction: ResizeDirection,
  bounds: ResizeBounds,
  coarse = false,
): number | null {
  const step = coarse ? COARSE_STEP_PX : STEP_PX;
  const towardRight = direction === "grow-right" ? step : -step;

  switch (key) {
    case "ArrowRight":
      return clampWidth(current + towardRight, bounds);
    case "ArrowLeft":
      return clampWidth(current - towardRight, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}
