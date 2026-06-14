import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../src/shared/types";
import { buildAiRequestPreview } from "./requestPreview";
import { writeAiResourceMetadata } from "./resources";

const project = {
  id: "project-1",
  name: "Scene",
  ai: { projectContext: "Black and white noir storyboards." },
  shots: [
    {
      id: "shot-1",
      imagePath: "/project/shot-1.tiff",
      fileName: "shot-1.tiff",
      order: 0,
      scriptText: "A detective enters the room."
    },
    {
      id: "shot-2",
      imagePath: "/project/shot-2.tiff",
      fileName: "shot-2.tiff",
      order: 1,
      scriptText: "The detective sees the suspect."
    }
  ],
  dialogues: [{ id: "dialogue-1", shotId: "shot-1", text: "Stay quiet.", order: 0 }],
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
} satisfies Project;

describe("AI request preview", () => {
  it("copies the prompt and selected image input summary without secrets or absolute paths", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-preview-"));
    await mkdir(path.join(folderPath, "AI Resources"));
    await writeFile(path.join(folderPath, "AI Resources/hero.png"), "hero image");
    await writeFile(path.join(folderPath, "AI Resources/room.png"), "room image");
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [
        { fileName: "hero.png", role: "Character reference", note: "Use the face." },
        { fileName: "room.png", role: "Scene reference", note: "Do not send this one." }
      ]
    });

    const preview = await buildAiRequestPreview({
      folderPath,
      project,
      shotId: "shot-1",
      selectedResourceIds: ["hero.png"],
      generationSettings: { provider: "seedream", model: "doubao-seedream-5.0-lite" }
    });

    expect(preview).toContain("Provider: seedream");
    expect(preview).toContain("Model: doubao-seedream-5.0-lite");
    expect(preview).toContain("Prompt:");
    expect(preview).toContain("Black and white noir storyboards.");
    expect(preview).toContain("A detective enters the room.");
    expect(preview).toContain("Stay quiet.");
    expect(preview).toContain("Reference 1: Character reference, hero.png. Use the face.");
    expect(preview).toContain("Image inputs:");
    expect(preview).toContain("1. selected-storyboard.png");
    expect(preview).toContain("2. hero.png - Character reference - Use the face.");
    expect(preview).not.toContain("Do not send this one.");
    expect(preview).not.toContain(folderPath);
    expect(preview).not.toContain("API key");
  });

  it("copies a batch request preview with grouping and per-shot resource rules", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-preview-batch-"));
    await mkdir(path.join(folderPath, "AI Resources"));
    await writeFile(path.join(folderPath, "AI Resources/hero.png"), "hero image");
    await writeFile(path.join(folderPath, "AI Resources/room.png"), "room image");
    await writeFile(path.join(folderPath, "AI Resources/unused.png"), "unused image");
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [
        { fileName: "hero.png", role: "Character reference", note: "Use the face." },
        { fileName: "room.png", role: "Scene reference", note: "Use the room." },
        { fileName: "unused.png", role: "Prop reference", note: "Do not send this one." }
      ]
    });

    const preview = await buildAiRequestPreview({
      folderPath,
      project,
      shotIds: ["shot-1", "shot-2"],
      selectedResourceIds: ["hero.png", "room.png"],
      resourceAssignments: { "shot-1": ["hero.png", "room.png"], "shot-2": ["hero.png"] },
      generationSettings: { provider: "openai", model: "gpt-image-2" }
    });

    expect(preview).toContain("Batch: 2 shots -> 1 generation: 2");
    expect(preview).toContain("Group 1 (2 panels):");
    expect(preview).toContain("Panel 1: shot-1.tiff");
    expect(preview).toContain("Panel 1 may use these AI Resources: Character reference hero.png, Scene reference room.png.");
    expect(preview).toContain("Panel 2: shot-2.tiff");
    expect(preview).toContain("Panel 2 may use these AI Resources: Character reference hero.png.");
    expect(preview).not.toContain("Auto from batch pool");
    expect(preview).toContain("Image inputs per generation:");
    expect(preview).toContain("selected-storyboards-contact-sheet.png");
    expect(preview).toContain("hero.png - Character reference - Use the face.");
    expect(preview).toContain("room.png - Scene reference - Use the room.");
    expect(preview).not.toContain("Do not send this one.");
    expect(preview).not.toContain(folderPath);
    expect(preview).not.toContain("API key");
  });
});
