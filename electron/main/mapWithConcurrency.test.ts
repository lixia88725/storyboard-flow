import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./mapWithConcurrency.js";

describe("mapWithConcurrency", () => {
  it("keeps result order while honoring the concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 20 : 1));
      running -= 1;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40]);
    expect(maxRunning).toBe(2);
  });

  it("calls item completion after successful and failed work", async () => {
    let completed = 0;

    await expect(
      mapWithConcurrency(
        [1, 2],
        1,
        async (item) => {
          if (item === 2) {
            throw new Error("failed");
          }
          return item;
        },
        () => {
          completed += 1;
        }
      )
    ).rejects.toThrow("failed");

    expect(completed).toBe(2);
  });

  it("returns an empty result for empty input", async () => {
    await expect(mapWithConcurrency([], 4, async (item) => item)).resolves.toEqual([]);
  });

  it("waits for started effects after a failure and does not claim more work", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const failure = new Error("first write refused");
    const started: number[] = [];
    let settled = false;
    const operation = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item);
      if (item === 0) throw failure;
      await held;
      return item;
    });
    const outcome = operation.then(() => undefined, (error: unknown) => error)
      .finally(() => { settled = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(started).toEqual([0, 1]);
    } finally {
      release();
      await outcome;
    }
    expect(await outcome).toBe(failure);
    expect(started).toEqual([0, 1]);
  });

  it("retains both a write failure and a completion callback failure", async () => {
    const writeError = new Error("write failed");
    const progressError = new Error("progress failed");
    const error = await mapWithConcurrency([0], 1, async () => {
      throw writeError;
    }, () => { throw progressError; }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([writeError, progressError]);
  });

  it("retains every started task failure in observed order after draining", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = new Error("first");
    const second = new Error("late");
    const operation = mapWithConcurrency([0, 1, 2], 2, async (item) => {
      if (item === 0) throw first;
      await held;
      throw second;
    }).catch((failure: unknown) => failure);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      release();
    }
    const error = await operation;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([first, second]);
  });
});
