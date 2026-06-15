import { describe, expect, it } from "vitest";
import { workspaceTaskUnitLabel } from "./WorkspaceOverlays";

describe("WorkspaceOverlays", () => {
  it("labels folder open progress as images and write progress as shots", () => {
    expect(workspaceTaskUnitLabel("open")).toBe("images");
    expect(workspaceTaskUnitLabel("save")).toBe("shots");
    expect(workspaceTaskUnitLabel("import")).toBe("shots");
  });
});
