import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../src/shared/types";
import { applyAiCandidateAsLayer, discardAiCandidate, writeAiCandidate } from "./candidates";

const project = {
  id: "project-1",
  name: "Scene",
  shots: [
    {
      id: "shot-1",
      imagePath: "/scene/shot-1.tiff",
      fileName: "shot-1.tiff",
      order: 0,
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
      ],
      activeLayerId: "layer-image"
    }
  ],
  dialogues: [],
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
} satisfies Project;

describe("AI candidates", () => {
  it("stores a normalized candidate and applies it as a top bitmap layer", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-"));
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#ff0000"
      }
    }).png().toBuffer();
    const candidate = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Generate a storyboard panel."
    });

    const result = await applyAiCandidateAsLayer({
      folderPath,
      project,
      candidateId: candidate.id
    });

    const shot = result.project.shots[0];
    expect(shot.activeLayerId).toBe(result.layer.id);
    expect(shot.layers?.at(-1)).toMatchObject({
      id: result.layer.id,
      kind: "paint",
      name: "AI Draft",
      bitmapPath: result.layer.bitmapPath,
      order: 1
    });
    expect((await readFile(path.join(folderPath, result.layer.bitmapPath))).length).toBeGreaterThan(0);
  });

  it("supports sequential batch apply and candidate discard", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-batch-"));
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#00ff00"
      }
    }).png().toBuffer();
    const projectWithTwoShots: Project = {
      ...project,
      shots: [
        project.shots[0],
        {
          ...project.shots[0],
          id: "shot-2",
          imagePath: "/scene/shot-2.tiff",
          fileName: "shot-2.tiff"
        }
      ]
    };
    const candidate1 = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Batch group prompt."
    });
    const candidate2 = await writeAiCandidate({
      folderPath,
      shotId: "shot-2",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Batch group prompt."
    });

    const first = await applyAiCandidateAsLayer({
      folderPath,
      project: projectWithTwoShots,
      candidateId: candidate1.id
    });
    const second = await applyAiCandidateAsLayer({
      folderPath,
      project: first.project,
      candidateId: candidate2.id
    });

    expect(second.project.shots[0].layers?.at(-1)?.name).toBe("AI Draft");
    expect(second.project.shots[1].layers?.at(-1)?.name).toBe("AI Draft");
    await discardAiCandidate(folderPath, candidate1.id);
    await expect(access(candidate1.filePath)).rejects.toThrow();
  });
});
