/**
 * Plain 404 for static-asset-like paths that do not exist (/favicon.ico, /missing.png), reached
 * through the afterFiles rewrite in next.config.ts. It does no session lookup and renders no
 * app markup, so crawlers and stray asset requests never touch Redis or the API.
 */
export function GET(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
