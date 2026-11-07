import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Paths ending in one of these extensions are treated as missing static files (see rewrites).
 * Dynamic routes must therefore never end in a listed extension: /library/export has no
 * extension for this reason (a "/library/export.csv" route would be rewritten to a 404), and
 * control codes (/library/RES-01) never contain a dot.
 */
const ASSET_EXTENSIONS =
  "ico|png|jpe?g|gif|webp|avif|svg|css|js|mjs|map|json|txt|xml|webmanifest|woff2?|ttf|otf";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server for the container image (infrastructure/docker/Dockerfile.web).
  output: "standalone",
  // Trace files from the repository root so workspace packages land in the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // The dev-mode badge sits on top of the account menu (bottom-left on desktop and mobile).
  devIndicators: false,
  // `next dev` only: extra hostnames (comma-separated) allowed to load dev resources, for
  // testing from other devices (docs/operations/local-development.md). Unset: localhost only.
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@isms/config",
    "@isms/contracts",
    "@isms/domain",
    "@isms/telemetry",
    "@isms/ui",
  ],
  // Node-only libraries loaded at runtime instead of being bundled.
  serverExternalPackages: ["ioredis", "pino"],
  // No page may be framed (clickjacking). The full Content-Security-Policy is Plan 4.
  headers: () =>
    Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]),
  /**
   * Missing static assets get a plain 404 without going through (app) and its session check.
   * afterFiles runs after real files and static routes (/_next/*, /icon.svg) but before the
   * (app) catch-all. Other dotted paths (/x/v1.2) still reach (app) and its session check.
   */
  rewrites: () =>
    Promise.resolve({
      beforeFiles: [],
      afterFiles: [
        { source: `/:path(.*\\.(?:${ASSET_EXTENSIONS}))`, destination: "/asset-not-found" },
      ],
      fallback: [],
    }),
  webpack: (config: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    // Workspace packages use NodeNext-style ".js" specifiers for ".ts" files. Turbopack has
    // no equivalent option yet, so the web app builds with webpack (`--webpack`).
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

// English only, no locale routing: see i18n.ts.
export default createNextIntlPlugin("./i18n.ts")(nextConfig);
