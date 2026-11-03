import { describe, expect, it, vi } from "vitest";
import { withStatus } from "./statusAction";

describe("withStatus", () => {
  it("returns the action result without setting status when the action succeeds", async () => {
    const setStatus = vi.fn();

    const result = await withStatus("Save failed", async () => "saved", setStatus);

    expect(result).toBe("saved");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("sets a labelled status and returns undefined when the action throws", async () => {
    const setStatus = vi.fn();

    const result = await withStatus("Open failed", async () => {
      throw new Error("folder missing");
    }, setStatus);

    expect(result).toBeUndefined();
    expect(setStatus).toHaveBeenCalledWith("Open failed: folder missing");
  });
});
