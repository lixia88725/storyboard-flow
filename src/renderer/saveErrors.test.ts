import { describe, expect, it } from "vitest";
import { formatSaveFailureStatus } from "./saveErrors";

describe("formatSaveFailureStatus", () => {
  it("explains temporary rename conflicts with a user action", () => {
    expect(
      formatSaveFailureStatus(
        "Error invoking remote method 'workspace:save': Error: Temporary rename file already exists: /tmp/scene/.storyboard-renaming-abc.png"
      )
    ).toBe(
      "Save failed: Save stopped because a temporary rename file already exists. Move or delete the .storyboard-renaming-* file in the folder, then try Save again. Details: /tmp/scene/.storyboard-renaming-abc.png"
    );
  });

  it("keeps other Save errors unchanged", () => {
    expect(formatSaveFailureStatus("Disk is full")).toBe("Save failed: Disk is full");
  });
});
