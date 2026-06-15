import { describe, expect, it } from "vitest";
import {
  aiPanelToggleStatus,
  appShellClassName,
  isAiPanelVisible
} from "./rightSidebarController";

describe("right sidebar shell controller", () => {
  it("shows the AI panel only when a workspace is open and the AI sidebar is active", () => {
    expect(isAiPanelVisible({ folderPath: undefined, isAiPanelOpen: true })).toBe(false);
    expect(isAiPanelVisible({ folderPath: "/workspace", isAiPanelOpen: false })).toBe(false);
    expect(isAiPanelVisible({ folderPath: "/workspace", isAiPanelOpen: true })).toBe(true);
  });

  it("builds stable app shell classes from sidebar visibility", () => {
    expect(
      appShellClassName({
        isAnimationMode: true,
        isParkingShelfOpen: true,
        isAiPanelVisible: true
      })
    ).toBe("app-shell is-animation-mode has-parking-shelf-open has-ai-panel-open");

    expect(
      appShellClassName({
        isAnimationMode: false,
        isParkingShelfOpen: false,
        isAiPanelVisible: false
      })
    ).toBe("app-shell");
  });

  it("explains why the AI panel cannot open before a workspace is loaded", () => {
    expect(aiPanelToggleStatus(undefined)).toBe("Open a folder before using AI Draft");
    expect(aiPanelToggleStatus("/workspace")).toBeUndefined();
  });
});
