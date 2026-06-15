import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceTaskProgressReporter,
  workspaceTaskProgressPayload
} from "./workspaceTaskProgress.js";

describe("workspaceTaskProgress", () => {
  it("adds the task kind to renderer progress payloads", () => {
    expect(
      workspaceTaskProgressPayload("save", {
        label: "Writing",
        current: 2,
        total: 4
      })
    ).toEqual({
      kind: "save",
      label: "Writing",
      current: 2,
      total: 4
    });
  });

  it("sends workspace task progress to the renderer channel", () => {
    const send = vi.fn();
    const reporter = createWorkspaceTaskProgressReporter({ send }, "import");

    reporter({ current: 1, total: 3 });

    expect(send).toHaveBeenCalledWith("workspace:taskProgress", {
      kind: "import",
      current: 1,
      total: 3
    });
  });
});
