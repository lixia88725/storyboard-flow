import { describe, expect, it } from "vitest";
import {
  aiResourceAssignmentSelectionKey,
  aiResourceMetadataPayload,
  nextAiResourcesWithMetadataPatch,
  uniqueAiResourceIds,
  type AiResource
} from "./useAiResourcesController";

const resources: AiResource[] = [
  {
    id: "resource-a",
    fileName: "a.png",
    filePath: "/workspace/.storyboard-workbench/ai-resources/a.png",
    role: "Character reference",
    note: "hero"
  },
  {
    id: "resource-b",
    fileName: "b.png",
    filePath: "/workspace/.storyboard-workbench/ai-resources/b.png",
    role: "Style reference",
    note: "noir"
  }
];

describe("AI resources controller", () => {
  it("updates resource metadata by file name without mutating other resources", () => {
    const nextResources = nextAiResourcesWithMetadataPatch(resources, "a.png", {
      note: "hero closeup"
    });

    expect(nextResources).toEqual([
      {
        ...resources[0],
        note: "hero closeup"
      },
      resources[1]
    ]);
    expect(resources[0].note).toBe("hero");
  });

  it("persists only resource metadata fields", () => {
    expect(aiResourceMetadataPayload(resources)).toEqual({
      version: 1,
      resources: [
        {
          fileName: "a.png",
          role: "Character reference",
          note: "hero"
        },
        {
          fileName: "b.png",
          role: "Style reference",
          note: "noir"
        }
      ]
    });
  });

  it("keeps unique resource ids in first-seen order", () => {
    expect(uniqueAiResourceIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("tracks multi-shot assignment changes by selected shot ids", () => {
    expect(
      aiResourceAssignmentSelectionKey({
        kind: "multi",
        count: 2,
        shots: [
          { id: "shot-a", fileName: "a.tiff", imagePath: "/tmp/a.tiff", order: 0 },
          { id: "shot-b", fileName: "b.tiff", imagePath: "/tmp/b.tiff", order: 1 }
        ]
      })
    ).toBe("shot-a|shot-b");

    expect(aiResourceAssignmentSelectionKey({ kind: "empty" })).toBe("");
  });
});
