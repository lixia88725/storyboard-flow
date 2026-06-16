import { describe, expect, it } from "vitest";
import {
  aiResourceAssignmentEmptyMessage,
  aiResourceEmptyMessage,
  aiResourceReferenceCountLabel
} from "./AiResourcesSection";

describe("AiResourcesSection", () => {
  it("keeps resource empty-state copy in the resource section", () => {
    expect(aiResourceEmptyMessage()).toBe(
      "Drop reference images here to add them to AI Resources."
    );
    expect(aiResourceAssignmentEmptyMessage()).toBe(
      "Drop reference images into AI Resources from a single shot."
    );
  });

  it("formats per-shot assignment reference counts", () => {
    expect(aiResourceReferenceCountLabel(0, 0)).toBe("0 / 0 references");
    expect(aiResourceReferenceCountLabel(1, 3)).toBe("1 / 3 references");
  });
});
