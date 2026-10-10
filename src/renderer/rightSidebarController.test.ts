import { describe, expect, it } from "vitest";
import { appShellClassName } from "./rightSidebarController";

describe("ordinary Pending layout", () => {
  it("uses the normal app shell when Pending is closed", () => {
    expect(appShellClassName({ isAnimationMode: false, isParkingShelfOpen: false })).toBe("app-shell");
  });
  it("combines animation and ordinary Pending without an AI layout", () => {
    expect(appShellClassName({ isAnimationMode: true, isParkingShelfOpen: true }))
      .toBe("app-shell is-animation-mode has-parking-shelf-open");
  });
});
