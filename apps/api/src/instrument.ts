// Imported first by main.ts so OpenTelemetry patches http, express, pg and ioredis before
// any of them is loaded (ES module imports are evaluated in order).
import { formatConfigErrorAndExit } from "@isms/config";
import { startTelemetry } from "@isms/telemetry";

try {
  startTelemetry("isms-api");
} catch (err) {
  formatConfigErrorAndExit(err);
}
