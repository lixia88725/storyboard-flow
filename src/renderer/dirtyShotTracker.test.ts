import { describe, expect, it } from "vitest";
import { createDirtyShotTracker } from "./dirtyShotTracker";

describe("dirtyShotTracker", () => {
  it("marks dirty shot ids without duplicating them", () => {
    const dirtyShotIdsRef = { current: new Set<string>(["shot-1"]) };
    const projectRef = { current: { shots: [] } };
    const tracker = createDirtyShotTracker({ dirtyShotIdsRef, projectRef });

    tracker.markShotsDirty(["shot-1", "shot-2"]);

    expect(tracker.dirtyShotIds()).toEqual(["shot-1", "shot-2"]);
  });

  it("marks every current project shot as dirty", () => {
    const dirtyShotIdsRef = { current: new Set<string>() };
    const projectRef = {
      current: {
        shots: [{ id: "shot-1" }, { id: "shot-2" }]
      }
    };
    const tracker = createDirtyShotTracker({ dirtyShotIdsRef, projectRef });

    tracker.markAllShotsDirty();

    expect(tracker.dirtyShotIds()).toEqual(["shot-1", "shot-2"]);
  });

  it("resets dirty shots by replacing the tracked set", () => {
    const originalSet = new Set<string>(["shot-1"]);
    const dirtyShotIdsRef = { current: originalSet };
    const projectRef = { current: { shots: [] } };
    const tracker = createDirtyShotTracker({ dirtyShotIdsRef, projectRef });

    tracker.resetDirtyShots();

    expect(tracker.dirtyShotIds()).toEqual([]);
    expect(dirtyShotIdsRef.current).not.toBe(originalSet);
  });
});
