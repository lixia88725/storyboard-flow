import { access, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../src/shared/types";
import {
  applyAiCandidateAsLayer,
  discardAiCandidate,
  listAiCandidates,
  promoteAiCandidateToShot,
  rollbackPromotedAiCandidateShot,
  writeAiCandidate
} from "./candidates";

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

    expect(path.dirname(candidate.filePath)).toBe(path.join(folderPath, "Pending"));
    expect(path.basename(candidate.filePath)).toMatch(/^AI_\d{14}_[a-f0-9]{8}\.png$/);

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

  it("lists valid historical candidates newest first and skips broken records", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-list-"));
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: "#0000ff"
      }
    }).png().toBuffer();
    const first = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "First"
    });
    const second = await writeAiCandidate({
      folderPath,
      shotId: "shot-2",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Second"
    });
    await writeFile(
      path.join(folderPath, ".storyboard-workbench/ai-candidates/broken.json"),
      "{not json",
      "utf8"
    );
    await unlink(first.filePath);

    const candidates = await listAiCandidates(folderPath);

    expect(candidates.map((candidate) => candidate.id)).toEqual([second.id]);
    expect(candidates[0].filePath).toBe(second.filePath);
  });

  it("promotes a candidate to a unique root TIFF without removing the candidate", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-promote-"));
    const png = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: "#ff00ff"
      }
    }).png().toBuffer();
    const candidate = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Promote"
    });

    const imagePath = await promoteAiCandidateToShot(folderPath, candidate.id);
    const metadata = await sharp(imagePath).metadata();

    expect(path.dirname(imagePath)).toBe(folderPath);
    expect(path.basename(imagePath)).toMatch(/^ai_draft_\d+_\d+\.tiff$/);
    expect(metadata).toMatchObject({ format: "tiff", width: 640, height: 360 });
    await expect(access(candidate.filePath)).resolves.toBeUndefined();
  });

  it("migrates a valid hidden historical candidate into the visible Pending folder", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-migrate-"));
    const png = await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 4,
        background: "#ffffff"
      }
    }).png().toBuffer();
    const candidate = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 640,
      height: 360,
      imageBuffer: png,
      prompt: "Historical"
    });
    const metadataPath = path.join(
      folderPath,
      ".storyboard-workbench/ai-candidates",
      `${candidate.id}.json`
    );
    const legacyBitmapPath = `.storyboard-workbench/ai-candidates/${candidate.id}.png`;
    const legacyFilePath = path.join(folderPath, legacyBitmapPath);
    await mkdir(path.dirname(legacyFilePath), { recursive: true });
    await rename(candidate.filePath, legacyFilePath);
    await writeFile(
      metadataPath,
      `${JSON.stringify({ ...candidate, bitmapPath: legacyBitmapPath, filePath: legacyFilePath }, null, 2)}\n`,
      "utf8"
    );

    const [migrated] = await listAiCandidates(folderPath);

    expect(path.dirname(migrated.filePath)).toBe(path.join(folderPath, "Pending"));
    await expect(access(migrated.filePath)).resolves.toBeUndefined();
    await expect(access(legacyFilePath)).rejects.toThrow();
    expect(JSON.parse(await readFile(metadataPath, "utf8"))).toMatchObject({
      bitmapPath: migrated.bitmapPath,
      filePath: migrated.filePath
    });
  });

  it("removes only root AI Draft TIFFs during promotion rollback", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-rollback-"));
    const imagePath = path.join(folderPath, "ai_draft_123_0.tiff");
    await writeFile(imagePath, "temporary tiff");

    await rollbackPromotedAiCandidateShot(folderPath, imagePath);

    await expect(access(imagePath)).rejects.toThrow();
    await expect(
      rollbackPromotedAiCandidateShot(folderPath, path.join(folderPath, "shot-1.tiff"))
    ).rejects.toThrow("rollback path is invalid");
  });

  it("sends a visible discarded candidate to Trash before deleting its metadata", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-candidate-trash-"));
    const candidate = await writeAiCandidate({
      folderPath,
      shotId: "shot-1",
      width: 32,
      height: 32,
      imageBuffer: await sharp({
        create: { width: 8, height: 8, channels: 4, background: "#000000" }
      }).png().toBuffer(),
      prompt: "Discard"
    });
    const trashItem = vi.fn(async () => undefined);

    await discardAiCandidate(folderPath, candidate.id, { trashItem });

    expect(trashItem).toHaveBeenCalledWith(candidate.filePath);
    await expect(
      access(path.join(folderPath, ".storyboard-workbench/ai-candidates", `${candidate.id}.json`))
    ).rejects.toThrow();
  });
});
