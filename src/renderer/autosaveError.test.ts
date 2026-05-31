import { describe, expect, it } from "vitest";
import { autosaveErrorReducer } from "./autosaveError";

describe("autosaveErrorReducer", () => {
  it("keeps the latest autosave failure visible until success or dismissal", () => {
    const failed = autosaveErrorReducer(undefined, {
      type: "failed",
      message: "Disk is full"
    });

    expect(failed).toEqual({ message: "Autosave failed: Disk is full" });
    expect(
      autosaveErrorReducer(failed, {
        type: "failed",
        message: "Permission denied"
      })
    ).toEqual({ message: "Autosave failed: Permission denied" });
    expect(autosaveErrorReducer(failed, { type: "dismissed" })).toBeUndefined();
    expect(autosaveErrorReducer(failed, { type: "saved" })).toBeUndefined();
  });
});
