import { describe, expect, it } from "vitest";
import { shouldDismissPopover } from "./popoverController";

describe("popoverController", () => {
  it("dismisses an open popover when the event target is outside its container", () => {
    const outsideTarget = {};
    const container = {
      contains: (target: object) => target !== outsideTarget
    };

    expect(shouldDismissPopover(container, outsideTarget)).toBe(true);
  });

  it("keeps an open popover when the event target is inside its container", () => {
    const insideTarget = {};
    const container = {
      contains: (target: object) => target === insideTarget
    };

    expect(shouldDismissPopover(container, insideTarget)).toBe(false);
  });

  it("dismisses when no container is mounted yet", () => {
    expect(shouldDismissPopover(null, {})).toBe(true);
  });
});
