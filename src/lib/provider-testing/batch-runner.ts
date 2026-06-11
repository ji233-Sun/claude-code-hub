/**
 * Batch test runner
 *
 * Pure concurrency/aggregation helpers for batch provider testing.
 * Client-safe: no server-only imports.
 */

import type { TestStatus } from "./types";

/** Lifecycle status of a single item inside a batch test run */
export type BatchTestItemStatus = "pending" | "running" | "skipped" | TestStatus;

export interface BatchTestSummary {
  total: number;
  /** Items that reached a terminal test verdict (green/yellow/red) */
  finished: number;
  green: number;
  yellow: number;
  red: number;
  skipped: number;
}

export function summarizeBatchTestStatuses(
  statuses: readonly BatchTestItemStatus[]
): BatchTestSummary {
  const summary: BatchTestSummary = {
    total: statuses.length,
    finished: 0,
    green: 0,
    yellow: 0,
    red: 0,
    skipped: 0,
  };
  for (const status of statuses) {
    if (status === "green" || status === "yellow" || status === "red") {
      summary[status] += 1;
      summary.finished += 1;
    } else if (status === "skipped") {
      summary.skipped += 1;
    }
  }
  return summary;
}

export interface BatchRunnerOptions<TItem, TResult> {
  /** Max number of items executed at the same time (default 5) */
  concurrency?: number;
  /** Checked before each item starts; cancelled items are never executed */
  isCancelled?: () => boolean;
  onItemStart?: (item: TItem, index: number) => void;
  onItemSettled?: (item: TItem, index: number, result: TResult) => void;
}

/**
 * Run `executor` over all items with a concurrency limit.
 *
 * The executor is expected to handle its own errors and return a result;
 * a thrown error aborts the whole run. Cancellation only prevents new items
 * from starting - in-flight items still settle. Returns results indexed by
 * item position; entries for never-started items stay undefined.
 */
export async function runBatchWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  executor: (item: TItem, index: number) => Promise<TResult>,
  options: BatchRunnerOptions<TItem, TResult> = {}
): Promise<Array<TResult | undefined>> {
  const { concurrency = 5, isCancelled, onItemStart, onItemSettled } = options;
  const results = new Array<TResult | undefined>(items.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (isCancelled?.()) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const item = items[index];
      onItemStart?.(item, index);
      const result = await executor(item, index);
      results[index] = result;
      onItemSettled?.(item, index, result);
    }
  });

  await Promise.all(workers);
  return results;
}
