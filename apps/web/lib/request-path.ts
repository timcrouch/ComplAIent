/**
 * Request header in which the proxy passes the requested path and query to the app, so the
 * (app) layout can send the user back there after sign-in. The proxy overwrites any incoming
 * value. Paths the proxy skips (with a dot) keep whatever the client sent, so the value is
 * untrusted: it is only ever used through safeReturnTo, which allows same-origin paths only.
 */
export const REQUEST_PATH_HEADER = "x-isms-path";
