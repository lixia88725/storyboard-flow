import { describe, expect, it, vi } from "vitest";
import { appendHistoryEntry, createSyncedHistoryStackSetter } from "./historyStackController";

describe("historyStackController", () => {
  it("applies functional updates from the ref value and writes the same stack to ref and state", () => {
    const stackRef = { current: ["first"] };
    const setStack = vi.fn();
    const setStackSynced = createSyncedHistoryStackSetter(stackRef, setStack);

    setStackSynced((current) => [...current, "second"]);

    expect(stackRef.current).toEqual(["first", "second"]);
    expect(setStack).toHaveBeenCalledWith(["first", "second"]);
  });

  it("accepts replacement stacks", () => {
    const stackRef = { current: ["old"] };
    const setStack = vi.fn();
    const setStackSynced = createSyncedHistoryStackSetter(stackRef, setStack);

    setStackSynced([]);

    expect(stackRef.current).toEqual([]);
    expect(setStack).toHaveBeenCalledWith([]);
  });

  it("appends entries while keeping the latest entries within the limit", () => {
    expect(appendHistoryEntry(["first", "second"], "third", 2)).toEqual(["second", "third"]);
  });
});
