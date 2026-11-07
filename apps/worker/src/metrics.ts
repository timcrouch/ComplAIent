import { metrics } from "@opentelemetry/api";
import type { Queue } from "@isms/jobs";

const STATES = ["waiting", "active", "completed", "failed", "delayed"] as const;

/** Observable gauge `isms_jobs` with `queue` and `state` attributes, read at scrape time. */
export function registerJobCountGauge(queues: readonly Queue[]): void {
  const unique = [...new Map(queues.map((q) => [q.name, q])).values()];
  const gauge = metrics
    .getMeter("isms-worker")
    .createObservableGauge("isms_jobs", { description: "Jobs per queue by state" });
  gauge.addCallback(async (result) => {
    await Promise.all(
      unique.map(async (queue) => {
        const counts = await queue.getJobCounts(...STATES);
        for (const state of STATES) {
          result.observe(counts[state] ?? 0, { queue: queue.name, state });
        }
      }),
    );
  });
}
