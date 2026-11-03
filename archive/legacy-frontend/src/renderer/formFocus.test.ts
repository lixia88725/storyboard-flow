import { afterEach, describe, expect, it, vi } from "vitest";
import { blurActiveFormControl } from "./formFocus";

class FakeElement {
  blur = vi.fn();

  constructor(private readonly selectorMatch: boolean) {}

  matches() {
    return this.selectorMatch;
  }
}

describe("blurActiveFormControl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blurs active input-like elements", () => {
    const activeElement = new FakeElement(true);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("document", { activeElement });

    blurActiveFormControl();

    expect(activeElement.blur).toHaveBeenCalled();
  });

  it("leaves non-form active elements focused", () => {
    const activeElement = new FakeElement(false);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("document", { activeElement });

    blurActiveFormControl();

    expect(activeElement.blur).not.toHaveBeenCalled();
  });
});
