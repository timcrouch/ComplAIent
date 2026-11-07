import { loadConfig, webConfig } from "@isms/config";
import { z } from "zod";

/** Plain http is a local-development exception, for localhost and 127.0.0.1 only. */
export function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** WEB_BASE_URL must be https, or plain http on localhost / 127.0.0.1 (any port). */
export const webBaseUrlField = webConfig.shape.WEB_BASE_URL.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || isLocalHttp(url);
  } catch {
    return false; // unparseable: reported as a ConfigError, not a TypeError
  }
}, "must be https, or http://localhost[:port] for local development");

const schema = z.object({ WEB_BASE_URL: webBaseUrlField });

/** Reads WEB_BASE_URL only (edge/proxy-safe: no secrets). */
export function webBaseUrl(): string {
  return loadConfig(schema).WEB_BASE_URL;
}

/** An absolute URL on this app; tolerates a trailing slash on WEB_BASE_URL. */
export function appUrl(path: string, base: string = webBaseUrl()): URL {
  return new URL(path, base);
}
