import { describe, expect, it } from "vitest";
import { shouldQuitAfterLastWindow } from "./appLifecycle.js";

describe("app lifecycle quit policy", () => {
  it("keeps the app alive when the last window is closed on macOS without an explicit Quit", () => {
    expect(shouldQuitAfterLastWindow(true, false)).toBe(false);
  });

  it("finishes an explicit Quit on macOS once the close barrier released the last window", () => {
    expect(shouldQuitAfterLastWindow(true, true)).toBe(true);
  });

  it("quits on other platforms whenever the last window closes", () => {
    expect(shouldQuitAfterLastWindow(false, false)).toBe(true);
    expect(shouldQuitAfterLastWindow(false, true)).toBe(true);
  });
});
