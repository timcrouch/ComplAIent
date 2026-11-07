/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "packages-no-apps",
      comment: "Shared packages must never depend on applications.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "ui-no-backend",
      comment: "packages/ui is presentation only: no database, config or telemetry.",
      severity: "error",
      from: { path: "^packages/ui/" },
      to: {
        path: [
          "^packages/(database|config|telemetry)/",
          "(^|/)@isms/(database|config|telemetry)(/|$)",
          "^@isms/(database|config|telemetry)(/|$)",
        ],
      },
    },
    {
      name: "ui-tokens-import-nothing",
      comment:
        "packages/ui/src/tokens is plain data shared with the API's PDF and Excel renderers: it must import nothing (no React).",
      severity: "error",
      from: { path: "^packages/ui/src/tokens/" },
      to: { pathNot: "^packages/ui/src/tokens/" },
    },
    {
      name: "ai-allowed-packages",
      comment:
        "packages/ai is framework-free gateway core: it may use only @isms/database, @isms/domain and @isms/config.",
      severity: "error",
      from: { path: "^packages/ai/(src|test)/" },
      to: {
        path: [
          "^packages/(?!ai/|database/|domain/|config/)[^/]+/",
          "(^|/)@isms/(?!ai(/|$)|database(/|$)|domain(/|$)|config(/|$))",
          "(^|/)(@nestjs|pino)(/|$)",
        ],
      },
    },
    {
      name: "demo-no-apps-or-frameworks",
      comment:
        "packages/demo is shared by the API and a CLI: it may not import apps (packages-no-apps) nor NestJS, Next.js or the UI.",
      severity: "error",
      from: { path: "^packages/demo/" },
      to: {
        path: ["^apps/", "^packages/ui/", "(^|/)@isms/ui(/|$)", "(^|/)(@nestjs|next|react)(/|$)"],
      },
    },
    {
      name: "web-no-database",
      comment: "The web app talks to the API only; it must not import the database package.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: {
        path: ["^packages/database/", "(^|/)@isms/database(/|$)", "^@isms/database(/|$)"],
      },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "api-module-index-only",
      comment: "API modules may import sibling modules only through their index.ts.",
      severity: "error",
      from: { path: "^apps/api/src/([^/]+)/" },
      to: {
        path: "^apps/api/src/([^/]+)/",
        pathNot: ["^apps/api/src/$1/", "^apps/api/src/[^/]+/index\\.ts$"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(dist|\\.next|coverage|node_modules)/|^packages/database/src/generated/|^[^/]+\\.[cm]?[jt]s$",
    },
    tsPreCompilationDeps: true,
    moduleSystems: ["es6", "cjs"],
  },
};
