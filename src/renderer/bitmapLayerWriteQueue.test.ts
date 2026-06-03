import { describe, expect, it } from "vitest";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";

describe("bitmap layer write queue", () => {
  it("runs writes for the same bitmap path in sequence", async () => {
    const queue = createBitmapLayerWriteQueue();
    const events: string[] = [];
    let finishFirst!: () => void;

    const first = queue.enqueue("layers/a.png", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push("first:end");
    });
    const second = queue.enqueue("layers/a.png", async () => {
      events.push("second:start");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    finishFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("waits for pending writes to drain even if a write fails", async () => {
    const queue = createBitmapLayerWriteQueue();
    const events: string[] = [];

    const failed = queue.enqueue("layers/a.png", async () => {
      events.push("failed:start");
      throw new Error("write failed");
    });
    const next = queue.enqueue("layers/a.png", async () => {
      events.push("next:start");
    });

    await expect(failed).rejects.toThrow("write failed");
    await queue.drain("layers/a.png");
    await next;

    expect(events).toEqual(["failed:start", "next:start"]);
  });
});
