import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../src/shared/types";
import { writeAiResourceMetadata } from "./resources";
import { generateAiBatchCandidates } from "./generateBatch";

const makePng = (color: string, width = 64, height = 36) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).png().toBuffer();

const makeFourPanelSheet = async () =>
  sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: "#ffffff"
    }
  })
    .composite([
      { input: await makePng("#ff0000", 100, 50), left: 0, top: 0 },
      { input: await makePng("#00ff00", 100, 50), left: 100, top: 0 },
      { input: await makePng("#0000ff", 100, 50), left: 0, top: 50 },
      { input: await makePng("#ffff00", 100, 50), left: 100, top: 50 }
    ])
    .png()
    .toBuffer();

const makeSixteenPanelSheet = async () => {
  const colors = Array.from({ length: 16 }, (_item, index) => {
    const channel = index * 16;
    return `#${channel.toString(16).padStart(2, "0")}0000`;
  });
  return sharp({
    create: {
      width: 160,
      height: 160,
      channels: 4,
      background: "#ffffff"
    }
  })
    .composite(
      await Promise.all(
        colors.map(async (color, index) => ({
          input: await makePng(color, 40, 40),
          left: (index % 4) * 40,
          top: Math.floor(index / 4) * 40
        }))
      )
    )
    .png()
    .toBuffer();
};

const centerPixel = async (filePath: string): Promise<[number, number, number]> => {
  const { data, info } = await sharp(await readFile(filePath))
    .resize({ width: 1, height: 1, fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBeGreaterThanOrEqual(3);
  return [data[0], data[1], data[2]];
};

const makeProject = async (folderPath: string, count: number): Promise<Project> => {
  const shots = [];
  for (let index = 0; index < count; index += 1) {
    const imagePath = path.join(folderPath, `shot-${index + 1}.png`);
    await writeFile(imagePath, await makePng("#cccccc"));
    shots.push({
      id: `shot-${index + 1}`,
      imagePath,
      fileName: `shot-${index + 1}.tiff`,
      order: index,
      scriptText: `Script for shot ${index + 1}.`,
      swb: { version: 1, status: "owned", canvasWidth: 64, canvasHeight: 36 }
    });
  }
  return {
    id: "project-1",
    name: "Scene",
    ai: { projectContext: "Keep all panels monochrome except test colors." },
    shots,
    dialogues: [{ id: "dialogue-1", shotId: "shot-1", text: "Keep moving.", order: 0 }],
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  } satisfies Project;
};

describe("AI batch candidate generation", () => {
  it("generates one contact sheet and crops four candidates back to matching shots", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-batch-"));
    await mkdir(path.join(folderPath, "AI Resources"));
    await writeFile(path.join(folderPath, "AI Resources/hero.png"), await makePng("#111111"));
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [{ fileName: "hero.png", role: "Character reference", note: "Use for the hero." }]
    });
    const project = await makeProject(folderPath, 4);
    const calls: Array<{ prompt: string; images: Array<{ name: string; buffer: Buffer }>; model?: string }> = [];

    const result = await generateAiBatchCandidates({
      folderPath,
      project,
      shotIds: ["shot-4", "shot-1", "shot-3", "shot-2"],
      selectedResourceIds: ["hero.png"],
      resourceAssignments: {
        "shot-1": ["hero.png"],
        "shot-2": ["hero.png"],
        "shot-3": [],
        "shot-4": ["hero.png"]
      },
      generationSettings: { model: "batch-model" },
      provider: {
        generate: async (request) => {
          calls.push(request);
          return makeFourPanelSheet();
        }
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("batch-model");
    expect(calls[0].images.map((image) => image.name)).toEqual([
      "selected-storyboards-contact-sheet.png",
      "hero.png"
    ]);
    expect(calls[0].prompt).toContain("four equal panels in a 2x2 grid");
    expect(calls[0].prompt).toContain("Panel 1: shot-1.tiff");
    expect(calls[0].prompt).toContain("Panel 1 may use these AI Resources: Character reference hero.png.");
    expect(calls[0].prompt).toContain("Panel 3 must not use any AI Resources");
    expect(result.groups).toEqual([
      {
        index: 0,
        shotIds: ["shot-1", "shot-2", "shot-3", "shot-4"],
        candidateIds: result.candidates.map((candidate) => candidate.id)
      }
    ]);
    expect(result.candidates.map((candidate) => candidate.shotId)).toEqual([
      "shot-1",
      "shot-2",
      "shot-3",
      "shot-4"
    ]);
    await expect(centerPixel(result.candidates[0].filePath)).resolves.toEqual([255, 0, 0]);
    await expect(centerPixel(result.candidates[1].filePath)).resolves.toEqual([0, 255, 0]);
    await expect(centerPixel(result.candidates[2].filePath)).resolves.toEqual([0, 0, 255]);
    await expect(centerPixel(result.candidates[3].filePath)).resolves.toEqual([255, 255, 0]);
  });

  it("generates one 16-panel contact sheet and crops sixteen candidates back to matching shots", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-batch-16-"));
    const project = await makeProject(folderPath, 16);
    const calls: Array<{ prompt: string; width?: number; height?: number; images: Array<{ name: string; buffer: Buffer }> }> = [];

    const result = await generateAiBatchCandidates({
      folderPath,
      project,
      shotIds: project.shots.map((shot) => shot.id).reverse(),
      batchSize: 16,
      provider: {
        generate: async (request) => {
          calls.push(request);
          return makeSixteenPanelSheet();
        }
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("sixteen equal panels in a 4x4 grid");
    expect(calls[0].images.map((image) => image.name)).toEqual(["selected-storyboards-contact-sheet.png"]);
    expect(result.groups).toEqual([
      {
        index: 0,
        shotIds: project.shots.map((shot) => shot.id),
        candidateIds: result.candidates.map((candidate) => candidate.id)
      }
    ]);
    expect(result.candidates).toHaveLength(16);
    expect(result.candidates.map((candidate) => candidate.shotId)).toEqual(project.shots.map((shot) => shot.id));
    await expect(centerPixel(result.candidates[0].filePath)).resolves.toEqual([0, 0, 0]);
    await expect(centerPixel(result.candidates[15].filePath)).resolves.toEqual([240, 0, 0]);
  });

  it("sends only resources used by each batch group", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-batch-resources-"));
    await mkdir(path.join(folderPath, "AI Resources"));
    await writeFile(path.join(folderPath, "AI Resources/hero.png"), await makePng("#111111"));
    await writeFile(path.join(folderPath, "AI Resources/room.png"), await makePng("#222222"));
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [
        { fileName: "hero.png", role: "Character reference", note: "Use for character A." },
        { fileName: "room.png", role: "Scene reference", note: "Use for the room." }
      ]
    });
    const project = await makeProject(folderPath, 5);
    const calls: Array<{ prompt: string; images: Array<{ name: string; buffer: Buffer }> }> = [];

    await generateAiBatchCandidates({
      folderPath,
      project,
      shotIds: ["shot-1", "shot-2", "shot-3", "shot-4", "shot-5"],
      selectedResourceIds: ["hero.png", "room.png"],
      resourceAssignments: {
        "shot-1": ["hero.png"],
        "shot-2": ["hero.png"],
        "shot-3": [],
        "shot-4": [],
        "shot-5": ["room.png"]
      },
      provider: {
        generate: async (request) => {
          calls.push(request);
          return makeFourPanelSheet();
        }
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].images.map((image) => image.name)).toEqual([
      "selected-storyboards-contact-sheet.png",
      "hero.png"
    ]);
    expect(calls[0].prompt).toContain("Reference 1: Character reference, hero.png. Use for character A.");
    expect(calls[0].prompt).not.toContain("room.png");
    expect(calls[1].images.map((image) => image.name)).toEqual([
      "selected-storyboards-contact-sheet.png",
      "room.png"
    ]);
    expect(calls[1].prompt).toContain("Reference 1: Scene reference, room.png. Use for the room.");
    expect(calls[1].prompt).not.toContain("hero.png");
  });

  it("keeps successful group candidates when a later group fails", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-batch-failure-"));
    const project = await makeProject(folderPath, 5);
    let callCount = 0;

    const result = await generateAiBatchCandidates({
      folderPath,
      project,
      shotIds: ["shot-1", "shot-2", "shot-3", "shot-4", "shot-5"],
      provider: {
        generate: async () => {
          callCount += 1;
          if (callCount === 2) {
            throw new Error("provider failed");
          }
          return makeFourPanelSheet();
        }
      }
    });

    expect(result.candidates).toHaveLength(4);
    expect(result.groups[0].candidateIds).toHaveLength(4);
    expect(result.groups[1]).toMatchObject({
      index: 1,
      shotIds: ["shot-5"],
      candidateIds: [],
      error: "provider failed"
    });
  });
});
