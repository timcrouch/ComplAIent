/**
 * "The user is moving to another setup step inside the app": set just before navigating
 * (a save's router.push, the step rail, Back) and consumed once by the next SetupFrame,
 * which then starts at its heading. A full page load never sets it, so focus stays put and
 * the skip link remains the first stop.
 */
let pending = false;

export function requestStepHeadingFocus(): void {
  pending = true;
}

/** True once per request; clears it. */
export function consumeStepHeadingFocus(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}
