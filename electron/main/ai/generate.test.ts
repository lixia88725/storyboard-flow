import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../src/shared/types";
import { generateAiCandidate } from "./generate";
import { writeAiResourceMetadata } from "./resources";

const makePng = (color: string, width = 64, height = 36) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).png().toBuffer();

describe("AI candidate generation", () => {
  it("sends prompt, current shot image, and selected annotated references to the provider", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-generate-"));
    await mkdir(path.join(folderPath, ".storyboard-workbench/layers/shot-1"), { recursive: true });
    await writeFile(
      path.join(folderPath, ".storyboard-workbench/layers/shot-1/layer-image.png"),
      await makePng("#336699")
    );
    await mkdir(path.join(folderPath, "AI Resources"));
    await writeFile(path.join(folderPath, "AI Resources/hero.png"), await makePng("#ff0000"));
    await writeFile(path.join(folderPath, "AI Resources/room.png"), await makePng("#00ff00"));
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [
        { fileName: "hero.png", role: "Character reference", note: "Use the face." },
        { fileName: "room.png", role: "Scene reference", note: "Do not send this one." }
      ]
    });
    const project = {
      id: "project-1",
      name: "Scene",
      ai: { projectContext: "Black and white noir storyboards." },
      shots: [
        {
          id: "shot-1",
          imagePath: path.join(folderPath, "shot-1.tiff"),
          fileName: "shot-1.tiff",
          order: 0,
          scriptText: "A detective enters the room.",
          swb: { version: 1, status: "owned", canvasWidth: 640, canvasHeight: 360 },
          layers: [
            {
              id: "layer-image",
              kind: "image",
              name: "Image",
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: "normal",
              order: 0,
              bitmapPath: ".storyboard-workbench/layers/shot-1/layer-image.png",
              width: 640,
              height: 360
            }
          ]
        }
      ],
      dialogues: [{ id: "dialogue-1", shotId: "shot-1", text: "Stay quiet.", order: 0 }],
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z"
    } satisfies Project;
    const calls: Array<{ prompt: string; images: Array<{ name: string; buffer: Buffer }>; model?: string }> = [];

    const candidate = await generateAiCandidate({
      folderPath,
      project,
      shotId: "shot-1",
      selectedShotContext: "Low angle composition.",
      selectedResourceIds: ["hero.png"],
      generationSettings: { model: "gpt-image-2" },
      provider: {
        generate: async (request) => {
          calls.push(request);
          return makePng("#111111", 128, 72);
        }
      }
    });

    expect(candidate.shotId).toBe("shot-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("Black and white noir storyboards.");
    expect(calls[0].prompt).toContain("A detective enters the room.");
    expect(calls[0].prompt).toContain("Stay quiet.");
    expect(calls[0].prompt).toContain("Reference 1: Character reference, hero.png. Use the face.");
    expect(calls[0].prompt).not.toContain("Do not send this one.");
    expect(calls[0].model).toBe("gpt-image-2");
    expect(calls[0].images.map((image) => image.name)).toEqual(["selected-storyboard.png", "hero.png"]);
  });
});
