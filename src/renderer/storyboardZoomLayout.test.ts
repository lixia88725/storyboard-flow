import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storyboardRowGaps, storyboardRowGapsAreConsistent } from "./storyboardZoomLayout";

describe("storyboard zoom layout", () => {
  it("measures row gaps from storyboard card rects", () => {
    expect(
      storyboardRowGaps([
        { left: 0, top: 0, right: 100, bottom: 60 },
        { left: 120, top: 0, right: 220, bottom: 62 },
        { left: 0, top: 82, right: 100, bottom: 142 },
        { left: 120, top: 82, right: 220, bottom: 144 }
      ])
    ).toEqual([20]);
  });

  it("flags 25 percent row gaps that are much larger than the 30 percent layout", () => {
    const thirtyPercentRects = [
      { left: 0, top: 0, right: 129, bottom: 81 },
      { left: 147, top: 0, right: 276, bottom: 81 },
      { left: 0, top: 101, right: 129, bottom: 182 },
      { left: 147, top: 101, right: 276, bottom: 182 }
    ];
    const consistentTwentyFivePercentRects = [
      { left: 0, top: 0, right: 108, bottom: 68 },
      { left: 126, top: 0, right: 234, bottom: 68 },
      { left: 0, top: 88, right: 108, bottom: 156 },
      { left: 126, top: 88, right: 234, bottom: 156 }
    ];
    const inflatedTwentyFivePercentRects = [
      { left: 0, top: 0, right: 108, bottom: 68 },
      { left: 126, top: 0, right: 234, bottom: 68 },
      { left: 0, top: 160, right: 108, bottom: 228 },
      { left: 126, top: 160, right: 234, bottom: 228 }
    ];

    expect(
      storyboardRowGapsAreConsistent({
        referenceRects: thirtyPercentRects,
        candidateRects: consistentTwentyFivePercentRects,
        maxExtraGap: 4
      })
    ).toBe(true);
    expect(
      storyboardRowGapsAreConsistent({
        referenceRects: thirtyPercentRects,
        candidateRects: inflatedTwentyFivePercentRects,
        maxExtraGap: 4
      })
    ).toBe(false);
  });

  it("lets animation-mode shot cards use the animation frame width", () => {
    const css = readFileSync(new URL("./styles/shot-card.css", import.meta.url), "utf8");
    const animationShotCardRule = css.match(/\.app-shell\.is-animation-mode \.shot-card\s*{(?<body>[^}]*)}/);

    expect(animationShotCardRule?.groups?.body).toContain("max-width: var(--animation-frame-width);");
  });
});
