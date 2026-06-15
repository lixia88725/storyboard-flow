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
});
