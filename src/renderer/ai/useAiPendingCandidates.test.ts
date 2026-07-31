import { describe, expect, it } from "vitest";
import {
  createAiCandidateRequestGate,
  mergeAiPendingCandidates,
  type AiPendingCandidate
} from "./useAiPendingCandidates";

const candidate = (id: string, createdAt: string): AiPendingCandidate => ({
  id,
  shotId: `shot-${id}`,
  bitmapPath: `Pending/AI_${id}.png`,
  filePath: `/scene/Pending/AI_${id}.png`,
  width: 1920,
  height: 1080,
  prompt: id,
  createdAt
});

describe("AI pending candidates", () => {
  it("appends repeated generations without duplicating ids and keeps newest first", () => {
    const first = candidate("first", "2026-07-31T01:00:00.000Z");
    const second = candidate("second", "2026-07-31T02:00:00.000Z");

    expect(mergeAiPendingCandidates([first], [second, first]).map((item) => item.id)).toEqual([
      "second",
      "first"
    ]);
  });

  it("rejects stale list responses after a newer refresh or local mutation", () => {
    const gate = createAiCandidateRequestGate();
    const firstRefresh = gate.begin();
    const secondRefresh = gate.begin();

    expect(gate.isCurrent(firstRefresh)).toBe(false);
    expect(gate.isCurrent(secondRefresh)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(secondRefresh)).toBe(false);
  });
});
