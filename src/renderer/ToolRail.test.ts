import { describe, expect, it } from "vitest";
import { nextCardFace } from "./ToolRail";

describe("ToolRail", () => {
  it("toggles between image and script card faces", () => {
    expect(nextCardFace("image")).toBe("script");
    expect(nextCardFace("script")).toBe("image");
  });
});
