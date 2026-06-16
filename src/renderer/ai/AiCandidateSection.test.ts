import { describe, expect, it } from "vitest";
import {
  aiCandidateActionLabels,
  aiCandidateEmptyMessage
} from "./AiCandidateSection";

describe("AiCandidateSection", () => {
  it("uses single-shot candidate copy for ready selections", () => {
    expect(aiCandidateEmptyMessage("single")).toBe(
      "Generate one candidate, then apply it as a new AI Draft layer."
    );
    expect(aiCandidateActionLabels("single")).toEqual({
      apply: "Apply",
      discard: "Discard"
    });
  });

  it("uses batch candidate copy for multi-shot selections", () => {
    expect(aiCandidateEmptyMessage("batch")).toBe(
      "Generate batch candidates, then apply them as new AI Draft layers."
    );
    expect(aiCandidateActionLabels("batch")).toEqual({
      apply: "Apply All",
      discard: "Discard All"
    });
  });
});
