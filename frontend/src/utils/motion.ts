const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MotionMediaMatcher = Pick<Window, "matchMedia">;

/**
 * Reports whether the viewer asked the system to reduce motion. Environments
 * without `matchMedia` (tests, older embedded webviews) are treated as allowing
 * motion so the interface keeps its default behavior.
 */
export function prefersReducedMotion(view: Partial<MotionMediaMatcher> = globalThis): boolean {
  const matchMedia = view.matchMedia;
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia.call(view, REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Picks the scroll behavior to hand to `scrollIntoView`, downgrading animated
 * scrolling to an instant jump when motion is reduced.
 */
export function scrollBehavior(
  preferred: ScrollBehavior,
  view: Partial<MotionMediaMatcher> = globalThis,
): ScrollBehavior {
  if (preferred === "auto") return "auto";
  return prefersReducedMotion(view) ? "auto" : preferred;
}
