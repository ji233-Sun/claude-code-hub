import { describe, expect, test } from "vitest";
import {
  type BatchTestItemStatus,
  runBatchWithConcurrency,
  summarizeBatchTestStatuses,
} from "./batch-runner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("runBatchWithConcurrency", () => {
  test("应该执行所有条目并按原始顺序返回结果", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runBatchWithConcurrency(items, async (item) => item * 10, {
      concurrency: 2,
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test("空列表应该直接返回空数组", async () => {
    const results = await runBatchWithConcurrency([], async () => "unused");
    expect(results).toEqual([]);
  });

  test("同时执行的条目数不应该超过并发上限", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    let active = 0;
    let maxActive = 0;

    const runPromise = runBatchWithConcurrency(
      gates.map((_, index) => index),
      async (index) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gates[index].promise;
        active -= 1;
        return index;
      },
      { concurrency: 2 }
    );

    // 逐个放行，确保所有条目都经历过并发窗口
    for (const gate of gates) {
      await Promise.resolve();
      gate.resolve();
    }
    await runPromise;

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("取消后不应该再启动新条目，但进行中的条目会正常结束", async () => {
    const firstGate = deferred<void>();
    let cancelled = false;
    const started: number[] = [];
    const settled: number[] = [];

    const runPromise = runBatchWithConcurrency(
      [0, 1, 2, 3],
      async (index) => {
        if (index === 0) {
          await firstGate.promise;
        }
        return index;
      },
      {
        concurrency: 1,
        isCancelled: () => cancelled,
        onItemStart: (_, index) => started.push(index),
        onItemSettled: (_, index) => settled.push(index),
      }
    );

    // 第一个条目进行中时取消
    await Promise.resolve();
    cancelled = true;
    firstGate.resolve();

    const results = await runPromise;

    expect(started).toEqual([0]);
    expect(settled).toEqual([0]);
    expect(results[0]).toBe(0);
    expect(results.slice(1)).toEqual([undefined, undefined, undefined]);
  });

  test("回调应该带上条目、序号和结果", async () => {
    const startCalls: Array<[string, number]> = [];
    const settleCalls: Array<[string, number, string]> = [];

    await runBatchWithConcurrency(["a", "b"], async (item) => item.toUpperCase(), {
      concurrency: 1,
      onItemStart: (item, index) => startCalls.push([item, index]),
      onItemSettled: (item, index, result) => settleCalls.push([item, index, result]),
    });

    expect(startCalls).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(settleCalls).toEqual([
      ["a", 0, "A"],
      ["b", 1, "B"],
    ]);
  });

  test("并发上限大于条目数或非法时也应该正常执行", async () => {
    expect(
      await runBatchWithConcurrency([1, 2], async (item) => item, { concurrency: 99 })
    ).toEqual([1, 2]);
    expect(await runBatchWithConcurrency([1, 2], async (item) => item, { concurrency: 0 })).toEqual(
      [1, 2]
    );
  });
});

describe("summarizeBatchTestStatuses", () => {
  test("应该正确统计各状态数量", () => {
    const statuses: BatchTestItemStatus[] = [
      "green",
      "green",
      "yellow",
      "red",
      "skipped",
      "pending",
      "running",
    ];

    expect(summarizeBatchTestStatuses(statuses)).toEqual({
      total: 7,
      finished: 4,
      green: 2,
      yellow: 1,
      red: 1,
      skipped: 1,
    });
  });

  test("空列表应该返回全零统计", () => {
    expect(summarizeBatchTestStatuses([])).toEqual({
      total: 0,
      finished: 0,
      green: 0,
      yellow: 0,
      red: 0,
      skipped: 0,
    });
  });
});
