import { describe, expect, it } from "vitest";
import { dragPreviewShotIds } from "./storyboardDnd";

describe("storyboard drag preview", () => {
  it("uses only the active shot when copying", () => {
    expect(
      dragPreviewShotIds({
        activeShotId: "shot-b",
        selectedShotIds: ["shot-a", "shot-b"],
        orderedShotIds: ["shot-a", "shot-b", "shot-c"],
        isCopyDrag: true
      })
    ).toEqual(["shot-b"]);
  });

  it("preserves storyboard order for selected shot moves", () => {
    expect(
      dragPreviewShotIds({
        activeShotId: "shot-c",
        selectedShotIds: ["shot-c", "shot-a"],
        orderedShotIds: ["shot-a", "shot-b", "shot-c"],
        isCopyDrag: false
      })
    ).toEqual(["shot-a", "shot-c"]);
  });

  it("uses only the active shot when it is not selected", () => {
    expect(
      dragPreviewShotIds({
        activeShotId: "shot-b",
        selectedShotIds: ["shot-a"],
        orderedShotIds: ["shot-a", "shot-b", "shot-c"],
        isCopyDrag: false
      })
    ).toEqual(["shot-b"]);
  });
});
