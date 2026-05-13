// @netea/observability/run-recorder — Writes logs/runs/{batch_id}.json
// per-run summary (KPI #4). The Slice 03 test asserts the file's shape.

export const __SCAFFOLD__ = true as const;

export type RunRecord = {
  batchId: string;
  totalCostUsd: number;
  firstTryPassPercent: number;
  afterRetryPercent: number;
  quarantinePercent: number;
  processedCount: number;
  aborted: boolean;
  abortReason: string | null;
  totalDurationMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
};

export class RunRecorder {
  constructor(private readonly _logsDir: string) {}

  async write(_record: RunRecord): Promise<string> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
