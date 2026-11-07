/**
 * A full page load, for URLs the client router must not fetch as RSC (sign-in starts with a
 * redirect to the identity provider). A module of its own so tests can observe it.
 */
export function goTo(href: string): void {
  window.location.assign(href);
}
