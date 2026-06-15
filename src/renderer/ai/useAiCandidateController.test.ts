import { describe, expect, it } from "vitest";
import {
  aiCandidateApplySuccessStatus,
  aiCandidateResetKey,
  hasAiCandidate,
  type AiCandidate
} from "./useAiCandidateController";

const candidate: AiCandidate = {
  id: "candidate-1",
  shotId: "shot-1",
  bitmapPath: ".storyboard-workbench/ai-candidates/candidate-1.png",
  filePath: "/workspace/.storyboard-workbench/ai-candidates/candidate-1.png",
  width: 1920,
  height: 1080,
  prompt: "Generate a storyboard frame",
  createdAt: "2026-06-15T00:00:00.000Z"
};

describe("AI candidate controller", () => {
  it("detects whether a single-shot candidate is active", () => {
    expect(hasAiCandidate(undefined)).toBe(false);
    expect(hasAiCandidate(candidate)).toBe(true);
  });

  it("resets candidates when folder or selected shots change", () => {
    expect(
      aiCandidateResetKey({
        folderPath: "/workspace",
        selectedShotIds: ["shot-1", "shot-2"]
      })
    ).toBe("/workspace|shot-1|shot-2");
  });

  it("keeps additive apply status explicit", () => {
    expect(aiCandidateApplySuccessStatus()).toBe("AI Draft layer added");
  });
});
