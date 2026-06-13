import { describe, expect, it } from "vitest";
import { shouldIgnoreWorkbenchWheelTarget } from "./workbenchWheel";

const wheelTarget = (matchedSelector: string | undefined) =>
  ({
    closest: (selector: string) =>
      matchedSelector && selector.includes(matchedSelector) ? {} : null
  }) as unknown as EventTarget;

describe("workbench wheel routing", () => {
  it("ignores wheel events that start inside the AI Draft panel", () => {
    expect(shouldIgnoreWorkbenchWheelTarget(wheelTarget(".ai-draft-panel"))).toBe(true);
  });

  it("keeps handling wheel events from the storyboard surface", () => {
    expect(shouldIgnoreWorkbenchWheelTarget(wheelTarget(undefined))).toBe(false);
  });
});
