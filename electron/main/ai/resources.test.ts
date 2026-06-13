import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deleteAiResourceFile, importAiResourceFiles, listAiResources, writeAiResourceMetadata } from "./resources";

describe("AI resources", () => {
  it("lists image resources with sidecar metadata", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-resources-"));
    const resourcesPath = path.join(folderPath, "AI Resources");
    await mkdir(resourcesPath);
    await writeFile(path.join(resourcesPath, "hero.png"), "not a real png");
    await writeFile(path.join(resourcesPath, "notes.txt"), "ignore");
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [{ fileName: "hero.png", role: "Character reference", note: "Use the face." }]
    });

    const resources = await listAiResources(folderPath);

    expect(resources.resources).toEqual([
      expect.objectContaining({
        fileName: "hero.png",
        role: "Character reference",
        note: "Use the face."
      })
    ]);
    expect(JSON.parse(await readFile(path.join(resourcesPath, "ai-resources.json"), "utf8"))).toMatchObject({
      resources: [{ fileName: "hero.png" }]
    });
  });

  it("imports dropped image files into the AI Resources folder without overwriting names", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-resources-"));
    const sourcePath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-resource-source-"));
    const resourcesPath = path.join(folderPath, "AI Resources");
    await mkdir(resourcesPath);
    await writeFile(path.join(resourcesPath, "hero.png"), "existing image");
    await writeFile(path.join(sourcePath, "hero.png"), "new hero image");
    await writeFile(path.join(sourcePath, "notes.txt"), "ignore");

    const result = await importAiResourceFiles(folderPath, [
      path.join(sourcePath, "hero.png"),
      path.join(sourcePath, "notes.txt")
    ]);

    expect(result.importedFileNames).toEqual(["hero-1.png"]);
    await expect(readFile(path.join(resourcesPath, "hero.png"), "utf8")).resolves.toBe("existing image");
    await expect(readFile(path.join(resourcesPath, "hero-1.png"), "utf8")).resolves.toBe("new hero image");
    expect(result.resources.map((resource) => resource.fileName)).toEqual(["hero-1.png", "hero.png"]);
  });

  it("deletes a resource image and removes its sidecar metadata", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-resources-"));
    const resourcesPath = path.join(folderPath, "AI Resources");
    await mkdir(resourcesPath);
    await writeFile(path.join(resourcesPath, "hero.png"), "hero image");
    await writeFile(path.join(resourcesPath, "room.png"), "room image");
    await writeAiResourceMetadata(folderPath, {
      version: 1,
      resources: [
        { fileName: "hero.png", role: "Character reference", note: "Use the face." },
        { fileName: "room.png", role: "Scene reference", note: "Keep this one." }
      ]
    });

    const result = await deleteAiResourceFile(folderPath, "hero.png");

    await expect(readFile(path.join(resourcesPath, "hero.png"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(resourcesPath, "room.png"), "utf8")).resolves.toBe("room image");
    expect(result.resources.map((resource) => resource.fileName)).toEqual(["room.png"]);
    expect(JSON.parse(await readFile(path.join(resourcesPath, "ai-resources.json"), "utf8"))).toMatchObject({
      resources: [{ fileName: "room.png", note: "Keep this one." }]
    });
  });
});
