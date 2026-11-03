import { describe, expect, it } from "vitest";
import {
  scrollDeltaForReservedViewport,
  scrollDeltaToAlignTop,
  scrollDeltaToCenterInReservedViewport
} from "./viewportGeometry";

describe("viewport geometry", () => {
  it("scrolls down when an element is hidden by the reserved bottom area", () => {
    expect(
      scrollDeltaForReservedViewport(
        { top: 220, bottom: 760, height: 540 },
        { height: 800, reservedBottom: 150, margin: 12 }
      )
    ).toBe(122);
  });

  it("keeps oversized elements below the top margin", () => {
    expect(
      scrollDeltaForReservedViewport(
        { top: 80, bottom: 820, height: 740 },
        { height: 800, reservedBottom: 150, margin: 12 }
      )
    ).toBe(68);
  });

  it("aligns different image stages to the same top edge", () => {
    expect(scrollDeltaToAlignTop({ top: 180 }, 14)).toBe(166);
    expect(scrollDeltaToAlignTop({ top: 84 }, 14)).toBe(70);
  });

  it("centers an image stage above a reserved timeline when it fits", () => {
    expect(
      scrollDeltaToCenterInReservedViewport(
        { top: 14, bottom: 600, height: 586 },
        { height: 900, reservedBottom: 180, margin: 14 }
      )
    ).toBe(-53);
  });

  it("keeps oversized image stages aligned below the top margin", () => {
    expect(
      scrollDeltaToCenterInReservedViewport(
        { top: 84, bottom: 824, height: 740 },
        { height: 900, reservedBottom: 180, margin: 14 }
      )
    ).toBe(70);
  });
});
