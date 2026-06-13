import { describe, expect, it } from "vitest";
import { toggleAiSidebar, togglePendingSidebar } from "./sidebarState";

describe("AI and Pending sidebars", () => {
  it("opens only one right sidebar at a time", () => {
    expect(toggleAiSidebar({ isAiOpen: false, isPendingOpen: true })).toEqual({
      isAiOpen: true,
      isPendingOpen: false
    });
    expect(togglePendingSidebar({ isAiOpen: true, isPendingOpen: false })).toEqual({
      isAiOpen: false,
      isPendingOpen: true
    });
  });

  it("closes the active sidebar when its own toggle is clicked", () => {
    expect(toggleAiSidebar({ isAiOpen: true, isPendingOpen: false })).toEqual({
      isAiOpen: false,
      isPendingOpen: false
    });
    expect(togglePendingSidebar({ isAiOpen: false, isPendingOpen: true })).toEqual({
      isAiOpen: false,
      isPendingOpen: false
    });
  });
});
