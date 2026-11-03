import { describe, expect, it } from "vitest";
import { hasOpenWorkspaceMenu } from "./workspaceMenuController";

describe("workspaceMenuController", () => {
  it("reports when any workspace popover menu is open", () => {
    expect(
      hasOpenWorkspaceMenu({
        isAddShotMenuOpen: false,
        isImportHelpOpen: false,
        isMatteMenuOpen: false,
        isRecentMenuOpen: false,
        isSaveMenuOpen: false
      })
    ).toBe(false);

    expect(
      hasOpenWorkspaceMenu({
        isAddShotMenuOpen: false,
        isImportHelpOpen: false,
        isMatteMenuOpen: false,
        isRecentMenuOpen: true,
        isSaveMenuOpen: false
      })
    ).toBe(true);

    expect(
      hasOpenWorkspaceMenu({
        isAddShotMenuOpen: false,
        isImportHelpOpen: false,
        isMatteMenuOpen: true,
        isRecentMenuOpen: false,
        isSaveMenuOpen: false
      })
    ).toBe(true);
  });
});
