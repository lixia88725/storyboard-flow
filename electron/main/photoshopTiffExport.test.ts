import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildPhotoshopTiffExportPlan,
  buildPhotoshopTiffInPlaceSavePlan,
  writePhotoshopLayeredTiffsForInPlaceSave
} from "./photoshopTiffExport.js";

const execFileAsync = promisify(execFile);
const photoshopTiffDepsDir = path.join(process.cwd(), "vendor/python/photoshop-tiff");

const layer = (patch: Partial<Parameters<typeof buildPhotoshopTiffExportPlan>[0]["shots"][number]["layers"][number]>) => ({
  id: "layer-image",
  kind: "image" as const,
  name: "Image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal" as const,
  order: 0,
  bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
  width: 320,
  height: 180,
  ...patch
});

describe("buildPhotoshopTiffExportPlan", () => {
  it("creates one Photoshop TIFF export job per shot in storyboard order", () => {
    const plan = buildPhotoshopTiffExportPlan(
      {
        name: "Demo",
        shots: [
          {
            id: "shot-b",
            imagePath: "/scene/b.tiff",
            fileName: "second shot.tiff",
            order: 1,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [layer({ id: "layer-image-b", bitmapPath: ".storyboard-workbench/layers/shot-b/layer-image.png" })]
          },
          {
            id: "shot-a",
            imagePath: "/scene/a.tiff",
            fileName: "first shot.tiff",
            order: 0,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [layer({})]
          }
        ]
      },
      "/scene",
      new Date("2026-05-30T01:02:03.000Z")
    );

    expect(plan.exportFolderPath).toBe("/scene/Photoshop TIFF Export/20260530T010203");
    expect(plan.jobs.map((job) => job.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(plan.jobs.map((job) => job.outputPath)).toEqual([
      "/scene/Photoshop TIFF Export/20260530T010203/0010-first_shot.tiff",
      "/scene/Photoshop TIFF Export/20260530T010203/0020-second_shot.tiff"
    ]);
  });

  it("builds bottom-to-top layer manifests with resolved layer assets", () => {
    const plan = buildPhotoshopTiffExportPlan(
      {
        name: "Demo",
        shots: [
          {
            id: "shot-a",
            imagePath: "/scene/a.tiff",
            fileName: "a.tiff",
            order: 0,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [
              layer({}),
              layer({
                id: "paint-2",
                kind: "paint",
                name: "Paint 2",
                order: 2,
                opacity: 0.5,
                blendMode: "screen",
                visible: false,
                bitmapPath: ".storyboard-workbench/layers/shot-a/paint-2.png"
              }),
              layer({
                id: "paint-1",
                kind: "paint",
                name: "Paint 1",
                order: 1,
                blendMode: "multiply",
                bitmapPath: ".storyboard-workbench/layers/shot-a/paint-1.png"
              })
            ]
          }
        ]
      },
      "/scene",
      new Date("2026-05-30T01:02:03.000Z")
    );

    expect(plan.jobs[0].manifest).toMatchObject({
      outputPath: "/scene/Photoshop TIFF Export/20260530T010203/0010-a.tiff",
      width: 320,
      height: 180,
      documentName: "0010-a",
      layers: [
        {
          name: "Image",
          path: "/scene/.storyboard-workbench/layers/shot-a/layer-image.png",
          opacity: 1,
          blendMode: "normal",
          visible: true,
          background: true
        },
        {
          name: "Paint 1",
          path: "/scene/.storyboard-workbench/layers/shot-a/paint-1.png",
          opacity: 1,
          blendMode: "multiply",
          visible: true,
          background: false
        },
        {
          name: "Paint 2",
          path: "/scene/.storyboard-workbench/layers/shot-a/paint-2.png",
          opacity: 0.5,
          blendMode: "screen",
          visible: false,
          background: false
        }
      ]
    });
  });

  it("rejects layer paths outside the SWB layer asset directory", () => {
    expect(() =>
      buildPhotoshopTiffExportPlan(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: "/scene/a.tiff",
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: "../escape.png" })]
            }
          ]
        },
        "/scene",
        new Date("2026-05-30T01:02:03.000Z")
      )
    ).toThrow("Layer bitmap path must stay under");
  });

  it("plans in-place Photoshop TIFF writes through temporary sibling files", () => {
    const plan = buildPhotoshopTiffInPlaceSavePlan(
      {
        name: "Demo",
        shots: [
          {
            id: "shot-a",
            imagePath: "/scene/a.tiff",
            fileName: "a.tiff",
            order: 0,
            swb: { canvasWidth: 320, canvasHeight: 180 },
            layers: [
              layer({}),
              layer({
                id: "paint-1",
                kind: "paint",
                name: "Paint 1",
                order: 1,
                bitmapPath: ".storyboard-workbench/layers/shot-a/paint-1.png"
              })
            ]
          }
        ]
      },
      "/scene",
      "save-123"
    );

    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0].outputPath).toBe("/scene/.storyboard-workbench/save-tmp/save-123/a.tiff");
    expect(plan.jobs[0].finalPath).toBe("/scene/a.tiff");
    expect(plan.jobs[0].manifest.outputPath).toBe("/scene/.storyboard-workbench/save-tmp/save-123/a.tiff");
    expect(plan.jobs[0].manifest.documentName).toBe("a");
  });

  it("writes in-place Photoshop TIFF save outputs to temp files without replacing originals", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-save-"));

    try {
      const originalPath = path.join(folderPath, "a.tiff");
      const fakeWriterPath = path.join(folderPath, "fake-writer.mjs");
      const layerPath = path.join(folderPath, ".storyboard-workbench/layers/shot-a/layer-image.png");

      await writeFile(originalPath, "original", "utf8");
      await mkdir(path.dirname(layerPath), { recursive: true });
      await writeFile(layerPath, "fake-png", "utf8");
      await writeFile(
        fakeWriterPath,
        [
          "import { readFile, writeFile } from 'node:fs/promises';",
          "const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));",
          "await writeFile(manifest.outputPath, `layered:${manifest.documentName}`, 'utf8');"
        ].join("\n"),
        "utf8"
      );

      const result = await writePhotoshopLayeredTiffsForInPlaceSave(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: originalPath,
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png" })]
            }
          ]
        },
        folderPath,
        {
          scriptPath: fakeWriterPath,
          pythonPath: process.execPath,
          saveStamp: "save-123"
        }
      );

      expect(result.replacements).toEqual([
        {
          fromPath: path.join(folderPath, ".storyboard-workbench/save-tmp/save-123/a.tiff"),
          toPath: originalPath
        }
      ]);
      await expect(readFile(originalPath, "utf8")).resolves.toBe("original");
      await expect(readFile(result.replacements[0].fromPath, "utf8")).resolves.toBe("layered:a");
      await expect(stat(path.join(folderPath, ".storyboard-workbench/save-tmp/save-123/.manifests/shot-a.json"))).resolves.toBeDefined();
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("drains a live exporter after a sibling progress failure without starting remaining jobs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-export-drain-"));
    const gate = path.join(root, "release");
    const scriptPath = path.join(root, "writer.mjs");
    const firstFailure = new Error("synthetic progress failure");
    let signalFailed!: () => void;
    const failed = new Promise<void>((resolve) => { signalFailed = resolve; });
    let finished = false;
    let progress = 0;
    let outcome: Promise<unknown> | undefined;
    try {
      // The exporter seam uses a synthetic codec, but actual child processes,
      // output files and a held native descriptor. No user TIFF is involved.
      await writeFile(scriptPath, [
        "import { open, readFile, stat, writeFile } from 'node:fs/promises';",
        "import path from 'node:path';",
        "const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));",
        "const root = process.env.DRAIN_ROOT;",
        "const wait = async name => { const until = Date.now() + 5000; while (!await stat(path.join(root,name)).then(()=>true,()=>false)) { if(Date.now()>until) throw new Error('gate timeout'); await new Promise(r=>setTimeout(r,5)); } };",
        "if(manifest.documentName === '0') await wait('started');",
        "const fd = await open(manifest.outputPath,'w');",
        "try { await fd.writeFile('partial'); if(manifest.documentName === '1') { await writeFile(path.join(root,'started'),'ready'); await wait('release'); await fd.writeFile('late-write'); } } finally { await fd.close(); }"
      ].join("\n"));
      const shots = [0, 1, 2].map((index) => ({
        id: `shot-${index}`, imagePath: path.join(root, `${index}.tiff`),
        fileName: `${index}.tiff`, order: index,
        swb: { canvasWidth: 320, canvasHeight: 180 }, layers: [layer({})]
      }));
      for (const shot of shots) await writeFile(shot.imagePath, "original");
      outcome = writePhotoshopLayeredTiffsForInPlaceSave({ name: "Synthetic", shots }, root, {
        scriptPath, pythonPath: process.execPath, saveStamp: "drain", concurrency: 2,
        env: { ...process.env, DRAIN_ROOT: root },
        onJobWritten: () => {
          if (progress++ === 0) { signalFailed(); throw firstFailure; }
        }
      }).then(() => undefined, (error: unknown) => error).finally(() => { finished = true; });
      await Promise.race([failed, outcome.then(() => { throw new Error("export ended before the held writer was ready"); })]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      expect(await stat(path.join(root, ".storyboard-workbench/save-tmp/drain/.manifests/shot-2.json"))
        .then(() => true, () => false)).toBe(false);
    } finally {
      const returnedBeforeRelease = finished;
      await writeFile(gate, "release");
      if (outcome) {
        const error = await outcome;
        try {
          // Even the known-broken baseline may have a child still running after
          // its outer promise rejected. Drain our synthetic children before rm.
          const deadline = Date.now() + 5000;
          while (progress < (returnedBeforeRelease ? 3 : 2) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          expect(error).toBe(firstFailure);
          expect(await stat(path.join(root, ".storyboard-workbench/save-tmp/drain/.manifests/shot-2.json"))
            .then(() => true, () => false)).toBe(false);
          expect(await readFile(path.join(root, "1.tiff"), "utf8")).toBe("original");
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      } else {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 15000);

  it("injects per-shot XMP into in-place Photoshop TIFF save manifests", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-save-xmp-"));

    try {
      const originalPath = path.join(folderPath, "a.tiff");
      const fakeWriterPath = path.join(folderPath, "fake-writer.mjs");
      const layerPath = path.join(folderPath, ".storyboard-workbench/layers/shot-a/layer-image.png");

      await writeFile(originalPath, "original", "utf8");
      await mkdir(path.dirname(layerPath), { recursive: true });
      await writeFile(layerPath, "fake-png", "utf8");
      await writeFile(
        fakeWriterPath,
        [
          "import { readFile, writeFile } from 'node:fs/promises';",
          "const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));",
          "await writeFile(manifest.outputPath, manifest.xmp ?? 'missing-xmp', 'utf8');"
        ].join("\n"),
        "utf8"
      );

      const result = await writePhotoshopLayeredTiffsForInPlaceSave(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: originalPath,
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png" })]
            }
          ]
        },
        folderPath,
        {
          scriptPath: fakeWriterPath,
          pythonPath: process.execPath,
          saveStamp: "save-123",
          xmpByShotId: { "shot-a": "<xmp>shot-a</xmp>" }
        }
      );

      await expect(readFile(result.replacements[0].fromPath, "utf8")).resolves.toBe("<xmp>shot-a</xmp>");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("injects per-shot SWB metadata into in-place Photoshop TIFF save manifests", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-save-swb-metadata-"));

    try {
      const originalPath = path.join(folderPath, "a.tiff");
      const fakeWriterPath = path.join(folderPath, "fake-writer.mjs");
      const layerPath = path.join(folderPath, ".storyboard-workbench/layers/shot-a/layer-image.png");

      await writeFile(originalPath, "original", "utf8");
      await mkdir(path.dirname(layerPath), { recursive: true });
      await writeFile(layerPath, "fake-png", "utf8");
      await writeFile(
        fakeWriterPath,
        [
          "import { readFile, writeFile } from 'node:fs/promises';",
          "const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));",
          "await writeFile(manifest.outputPath, JSON.stringify(manifest.swbMetadata ?? null), 'utf8');"
        ].join("\n"),
        "utf8"
      );

      const result = await writePhotoshopLayeredTiffsForInPlaceSave(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: originalPath,
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png" })]
            }
          ]
        },
        folderPath,
        {
          scriptPath: fakeWriterPath,
          pythonPath: process.execPath,
          saveStamp: "save-123",
          swbMetadataByShotId: { "shot-a": { shotId: "shot-a", baseFingerprint: "" } }
        }
      );

      await expect(readFile(result.replacements[0].fromPath, "utf8")).resolves.toBe(
        JSON.stringify({ shotId: "shot-a", baseFingerprint: "" })
      );
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("runs in-place Photoshop TIFF save jobs with limited concurrency", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-save-concurrency-"));

    try {
      const originalAPath = path.join(folderPath, "a.tiff");
      const originalBPath = path.join(folderPath, "b.tiff");
      const fakeWriterPath = path.join(folderPath, "fake-writer.mjs");
      const layerAPath = path.join(folderPath, ".storyboard-workbench/layers/shot-a/layer-image.png");
      const layerBPath = path.join(folderPath, ".storyboard-workbench/layers/shot-b/layer-image.png");

      await writeFile(originalAPath, "original-a", "utf8");
      await writeFile(originalBPath, "original-b", "utf8");
      await mkdir(path.dirname(layerAPath), { recursive: true });
      await mkdir(path.dirname(layerBPath), { recursive: true });
      await writeFile(layerAPath, "fake-png-a", "utf8");
      await writeFile(layerBPath, "fake-png-b", "utf8");
      await writeFile(
        fakeWriterPath,
        [
          "import { readFile, writeFile, stat } from 'node:fs/promises';",
          "import path from 'node:path';",
          "const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));",
          "const root = path.dirname(path.dirname(manifest.outputPath));",
          "const marker = path.join(root, `${manifest.documentName}.started`);",
          "await writeFile(marker, 'started', 'utf8');",
          "if (manifest.documentName === 'a') {",
          "  const peer = path.join(root, 'b.started');",
          "  const started = Date.now();",
          "  while (Date.now() - started < 1000) {",
          "    try { await stat(peer); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }",
          "  }",
          "  try { await stat(peer); } catch { process.exit(2); }",
          "}",
          "await writeFile(manifest.outputPath, `layered:${manifest.documentName}`, 'utf8');"
        ].join("\n"),
        "utf8"
      );

      const result = await writePhotoshopLayeredTiffsForInPlaceSave(
        {
          name: "Demo",
          shots: [
            {
              id: "shot-a",
              imagePath: originalAPath,
              fileName: "a.tiff",
              order: 0,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png" })]
            },
            {
              id: "shot-b",
              imagePath: originalBPath,
              fileName: "b.tiff",
              order: 1,
              swb: { canvasWidth: 320, canvasHeight: 180 },
              layers: [layer({ bitmapPath: ".storyboard-workbench/layers/shot-b/layer-image.png" })]
            }
          ]
        },
        folderPath,
        {
          scriptPath: fakeWriterPath,
          pythonPath: process.execPath,
          saveStamp: "save-123",
          concurrency: 2
        }
      );

      await expect(readFile(result.replacements[0].fromPath, "utf8")).resolves.toBe("layered:a");
      await expect(readFile(result.replacements[1].fromPath, "utf8")).resolves.toBe("layered:b");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("writes optional XMP into Photoshop layered TIFFs without dropping layer data", async () => {
    const depsDir = photoshopTiffDepsDir;
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-xmp-"));

    try {
      const layerPath = path.join(folderPath, "layer.png");
      const outputPath = path.join(folderPath, "out.tiff");
      const manifestPath = path.join(folderPath, "manifest.json");
      const scriptPath = path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py");
      const xmp = [
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
        '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:swb="https://storyboard-workbench.local/ns/1.0/">',
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '<rdf:Description rdf:about="">',
        '<swb:metadata>eyJzaG90SWQiOiJzaG90LWEifQ==</swb:metadata>',
        '</rdf:Description>',
        '</rdf:RDF>',
        '</x:xmpmeta>',
        '<?xpacket end="w"?>'
      ].join("\n");

      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      })
        .png()
        .toFile(layerPath);
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            outputPath,
            width: 2,
            height: 2,
            documentName: "xmp-test",
            xmp,
            layers: [
              {
                name: "Layer 1",
                path: layerPath,
                opacity: 1,
                blendMode: "normal",
                visible: true,
                background: true
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await execFileAsync("python3", [scriptPath, manifestPath], {
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: depsDir }
      });

      const metadata = await sharp(outputPath).metadata();
      expect(metadata.xmpAsString).toContain("<swb:metadata>eyJzaG90SWQiOiJzaG90LWEifQ==</swb:metadata>");
      const { stdout } = await execFileAsync("python3", [
        "-c",
        "import sys; sys.path.insert(0, sys.argv[2]); from psdtags import TiffImageSourceData; print(len(TiffImageSourceData.fromtiff(sys.argv[1]).layers))",
        outputPath,
        depsDir
      ]);
      expect(stdout.trim()).toBe("1");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("writes SWB metadata XMP with a computed composite fingerprint", async () => {
    const depsDir = photoshopTiffDepsDir;
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-swb-metadata-"));

    try {
      const layerPath = path.join(folderPath, "layer.png");
      const outputPath = path.join(folderPath, "out.tiff");
      const manifestPath = path.join(folderPath, "manifest.json");
      const scriptPath = path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py");
      const expectedFingerprint = createHash("sha256")
        .update("2x2:4:")
        .update(Buffer.from([
          255, 0, 0, 255,
          255, 0, 0, 255,
          255, 0, 0, 255,
          255, 0, 0, 255
        ]))
        .digest("hex");

      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      })
        .png()
        .toFile(layerPath);
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            outputPath,
            width: 2,
            height: 2,
            documentName: "swb-metadata-test",
            swbMetadata: {
              app: "Storyboard Workbench",
              format: "swb-tiff",
              version: 1,
              shotId: "shot-a",
              canvasWidth: 2,
              canvasHeight: 2,
              baseFingerprint: "",
              updatedAt: "2026-05-30T00:00:00.000Z",
              layers: []
            },
            layers: [
              {
                name: "Layer 1",
                path: layerPath,
                opacity: 1,
                blendMode: "normal",
                visible: true,
                background: true
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await execFileAsync("python3", [scriptPath, manifestPath], {
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: depsDir }
      });

      const metadata = await sharp(outputPath).metadata();
      const match = /<swb:metadata>([^<]+)<\/swb:metadata>/u.exec(metadata.xmpAsString ?? "");
      expect(match).toBeTruthy();
      const parsed = JSON.parse(Buffer.from(match?.[1] ?? "", "base64").toString("utf8"));
      expect(parsed.baseFingerprint).toBe(expectedFingerprint);
      const { stdout } = await execFileAsync("python3", [
        "-c",
        "import sys; sys.path.insert(0, sys.argv[2]); from psdtags import TiffImageSourceData; print(len(TiffImageSourceData.fromtiff(sys.argv[1]).layers))",
        outputPath,
        depsDir
      ]);
      expect(stdout.trim()).toBe("1");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("writes the main Photoshop TIFF composite over a white canvas", async () => {
    const depsDir = photoshopTiffDepsDir;
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-white-"));

    try {
      const layerPath = path.join(folderPath, "transparent-layer.png");
      const outputPath = path.join(folderPath, "out.tiff");
      const manifestPath = path.join(folderPath, "manifest.json");
      const scriptPath = path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py");

      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
        .png()
        .toFile(layerPath);
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            outputPath,
            width: 2,
            height: 2,
            documentName: "white-composite-test",
            layers: [
              {
                name: "Transparent Paint",
                path: layerPath,
                opacity: 1,
                blendMode: "normal",
                visible: true,
                background: false
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await execFileAsync("python3", [scriptPath, manifestPath], {
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: depsDir }
      });

      const { data } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(Array.from(data.slice(0, 4))).toEqual([255, 255, 255, 255]);
      const { stdout } = await execFileAsync("python3", [
        "-c",
        "import sys; sys.path.insert(0, sys.argv[2]); from psdtags import TiffImageSourceData; print(len(TiffImageSourceData.fromtiff(sys.argv[1]).layers))",
        outputPath,
        depsDir
      ]);
      expect(stdout.trim()).toBe("1");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it.each([[true, true], [false, true], [false, false]] as const)("keeps paint-visible=%s background-visible=%s records and preserves all-hidden fallback", async (visible, backgroundVisible) => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-native-visible-"));
    try {
      const background = path.join(folderPath, "background.png");
      const drawing = path.join(folderPath, "drawing.png");
      const outputPath = path.join(folderPath, "out.tiff");
      const manifestPath = path.join(folderPath, "manifest.json");
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).png().toFile(background);
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toFile(drawing);
      await writeFile(manifestPath, JSON.stringify({ outputPath, width: 2, height: 2, documentName: "visibility-regression", layers: [
        { name: "Image", path: background, opacity: 1, blendMode: "normal", visible: backgroundVisible, background: true },
        { name: "Drawing", path: drawing, opacity: 0.5, blendMode: "normal", visible, background: false }
      ] }));
      await execFileAsync("python3", [path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"), manifestPath], {
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: photoshopTiffDepsDir, PYTHONDONTWRITEBYTECODE: "1" }
      });
      const pixels = await sharp(outputPath).ensureAlpha().raw().toBuffer();
      // Before this repair the native exporter composited every layer even
      // when all were hidden. Keep that legacy all-hidden result unchanged.
      expect([...pixels.subarray(0, 4)]).toEqual(visible || !backgroundVisible ? [255, 127, 127, 255] : [255, 255, 255, 255]);
      const { stdout } = await execFileAsync("python3", ["-c",
        "import sys,json; sys.path.insert(0,sys.argv[2]); from psdtags import TiffImageSourceData,PsdLayerFlag; layers=TiffImageSourceData.fromtiff(sys.argv[1]).layers; print(json.dumps({'count':len(layers),'hidden':[bool(l.flags & PsdLayerFlag.VISIBLE) for l in layers]}))",
        outputPath, photoshopTiffDepsDir
      ], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
      expect(JSON.parse(stdout)).toEqual({ count: 2, hidden: [!backgroundVisible, !visible] });
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("writes Photoshop TIFF layers with non-MacRoman Unicode names", async () => {
    const depsDir = photoshopTiffDepsDir;
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-photoshop-tiff-unicode-"));

    try {
      const layerPath = path.join(folderPath, "layer.png");
      const outputPath = path.join(folderPath, "out.tiff");
      const manifestPath = path.join(folderPath, "manifest.json");
      const scriptPath = path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py");

      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 }
        }
      })
        .png()
        .toFile(layerPath);
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            outputPath,
            width: 2,
            height: 2,
            documentName: "unicode-layer-name-test",
            layers: [
              {
                name: "鑳",
                path: layerPath,
                opacity: 1,
                blendMode: "normal",
                visible: true,
                background: true
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await execFileAsync("python3", [scriptPath, manifestPath], {
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: depsDir }
      });

      const { stdout } = await execFileAsync("python3", [
        "-c",
        "import sys; sys.path.insert(0, sys.argv[2]); from psdtags import TiffImageSourceData; print(len(TiffImageSourceData.fromtiff(sys.argv[1]).layers))",
        outputPath,
        depsDir
      ]);
      expect(stdout.trim()).toBe("1");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });
});
