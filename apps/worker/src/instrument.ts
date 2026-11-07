// Imported first by main.ts so OpenTelemetry patches http and ioredis before they load.
import { formatConfigErrorAndExit, loadConfig, workerConfig } from "@isms/config";
import { startTelemetry } from "@isms/telemetry";

try {
  startTelemetry("isms-worker", {
    metricsPort: loadConfig(workerConfig).WORKER_METRICS_PORT,
    handleSignals: false,
  });
} catch (err) {
  formatConfigErrorAndExit(err);
}
