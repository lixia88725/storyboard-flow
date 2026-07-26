import { describe, expect, it, vi } from "vitest";
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

  it("blocks new bitmap writes until an exclusive workspace transaction finishes", async () => {
    const queue = createBitmapLayerWriteQueue();
    const events: string[] = [];
    let finishExisting!: () => void;
    let finishExclusive!: () => void;

    const existing = queue.enqueue("layers/a.png", async () => {
      events.push("existing:start");
      await new Promise<void>((resolve) => {
        finishExisting = resolve;
      });
      events.push("existing:end");
    });
    await Promise.resolve();
    await Promise.resolve();

    const exclusive = queue.runExclusive(async () => {
      events.push("exclusive:start");
      await new Promise<void>((resolve) => {
        finishExclusive = resolve;
      });
      events.push("exclusive:end");
    });
    const later = queue.enqueue("layers/b.png", async () => {
      events.push("later:start");
    });

    finishExisting();
    await existing;
    await vi.waitFor(() =>
      expect(events).toEqual(["existing:start", "existing:end", "exclusive:start"])
    );

    finishExclusive();
    await Promise.all([exclusive, later]);
    expect(events).toEqual([
      "existing:start",
      "existing:end",
      "exclusive:start",
      "exclusive:end",
      "later:start"
    ]);
  });
});
