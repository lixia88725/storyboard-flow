import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { decodeNormalSaveImportResult } from "../dist-electron/shared/normalSaveImportIpc.js";
import { previewPathForImage, previewRootForFolder } from "../dist-electron/main/previewPaths.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeTmpRoot = os.tmpdir();
const smokeRoot = path.join(smokeTmpRoot, `swb-bitmap-smoke-${Date.now()}`);
const scriptRoot = path.join(smokeTmpRoot, `swb-script-smoke-${Date.now()}`);
const scriptRootImportEvidenceRoot = `${scriptRoot}-import-evidence`;
const mdBootstrapRoot = path.join(smokeTmpRoot, `swb-md-bootstrap-source-${Date.now()}`);
const mdBootstrapTargetRoot = path.join(smokeTmpRoot, `swb-md-bootstrap-target-${Date.now()}`);
const mdEmbeddedMatteTargetRoot = path.join(
  smokeTmpRoot,
  `swb-md-embedded-matte-target-${Date.now()}`
);
const deleteRoot = path.join(smokeTmpRoot, `swb-delete-smoke-${Date.now()}`);
const clipboardRoot = path.join(smokeTmpRoot, `swb-clipboard-smoke-${Date.now()}`);
const denseMarqueeRoot = path.join(smokeTmpRoot, `swb-dense-marquee-smoke-${Date.now()}`);
const legacyRoot = path.join(smokeTmpRoot, `swb-legacy-smoke-${Date.now()}`);
const photoshopImportRoot = path.join(smokeTmpRoot, `swb-photoshop-import-${Date.now()}`);
const savedLayeredImportRoot = path.join(smokeTmpRoot, `swb-saved-layered-import-${Date.now()}`);
const port = String(9300 + Math.floor(Math.random() * 400));
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");
const photoshopPythonDepsDir =
  process.env.SWB_PYTHON_DEPS_DIR ?? path.join(repoRoot, "vendor", "python", "photoshop-tiff");

// Shared smoke helpers.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (fn, label, timeoutMs = 10000) => {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
};

const hashFile = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const findShotLayerPath = async (folderPath, shotIndex, layerId = "layer-image") => {
  const project = await readProjectMetadata(folderPath);
  const shot = project.shots?.[shotIndex];
  const layer = shot?.layers?.find((item) => item.id === layerId);
  if (!layer) {
    return undefined;
  }

  const filePath = resolveLayerPath(folderPath, layer.bitmapPath);
  await stat(filePath);
  return filePath;
};

const findShotLayerMetadataPath = async (folderPath, shotIndex, layerId = "layer-image") => {
  const project = await readProjectMetadata(folderPath);
  const shot = project.shots?.[shotIndex];
  const layer = shot?.layers?.find((item) => item.id === layerId);
  return layer ? resolveLayerPath(folderPath, layer.bitmapPath) : undefined;
};

const findShotLayerMetadataPathById = async (folderPath, shotId, layerId = "layer-image") => {
  const project = await readProjectMetadata(folderPath);
  const shot = project.shots?.find((item) => item.id === shotId);
  const layer = shot?.layers?.find((item) => item.id === layerId);
  return layer ? resolveLayerPath(folderPath, layer.bitmapPath) : undefined;
};

const findActiveShotLayerMetadataPathById = async (folderPath, shotId) => {
  const project = await readProjectMetadata(folderPath);
  const shot = project.shots?.find((item) => item.id === shotId);
  const activeLayer =
    shot?.layers?.find((item) => item.id === shot.activeLayerId) ??
    shot?.layers?.find((item) => item.id === "layer-image") ??
    shot?.layers?.find((item) => item.visible);
  return activeLayer ? resolveLayerPath(folderPath, activeLayer.bitmapPath) : undefined;
};

const layerAssetState = async (filePath) =>
  (await fileExists(filePath)) ? hashFile(filePath) : "missing";

const resolveLayerPath = (folderPath, bitmapPath) => path.join(folderPath, bitmapPath);

const projectMetadataPath = (folderPath) =>
  path.join(folderPath, ".storyboard-workbench", "storyboard.project.json");

const readProjectMetadata = async (folderPath) =>
  JSON.parse(await readFile(projectMetadataPath(folderPath), "utf8"));

const findTiffFiles = async (folderPath) =>
  (await readdir(folderPath)).filter((fileName) => /\.(tif|tiff)$/i.test(fileName));

const findPhotoshopExportFiles = async (folderPath) => {
  const exportRoot = path.join(folderPath, "Photoshop TIFF Export");
  const batches = await readdir(exportRoot).catch(() => []);
  const files = [];

  for (const batch of batches) {
    const batchPath = path.join(exportRoot, batch);
    const fileNames = await readdir(batchPath).catch(() => []);
    for (const fileName of fileNames) {
      if (/\.(tif|tiff)$/i.test(fileName)) {
        files.push(path.join(batchPath, fileName));
      }
    }
  }

  return files.sort();
};

const readPhotoshopLayerNames = (filePath) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        "-c",
        [
          "import json, sys",
          "from psdtags import TiffImageSourceData",
          "data = TiffImageSourceData.fromtiff(sys.argv[1])",
          "print(json.dumps([layer.name for layer in data.layers]))"
        ].join("; "),
        filePath
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: photoshopPythonDepsDir
        }
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psdtags readback failed: ${stderr || stdout}`));
        return;
      }

      resolve(JSON.parse(stdout));
    });
  });

const fileExists = async (filePath) =>
  stat(filePath)
    .then(() => true)
    .catch(() => false);

const collectLayerAssetPaths = async (folderPath) => {
  const layerRoot = path.join(folderPath, ".storyboard-workbench", "layers");
  const results = [];

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".png")) {
        results.push(entryPath);
      }
    }
  };

  await visit(layerRoot);
  return results;
};

const waitForLayerAssetPath = (folderPath, bitmapPath, label) =>
  waitFor(async () => {
    const layerPath = resolveLayerPath(folderPath, bitmapPath);
    return (await fileExists(layerPath)) ? layerPath : undefined;
  }, label);

const assertNoUnreferencedLayerAssets = async (folderPath, project) => {
  const referencedLayerAssetPaths = new Set(
    project.shots.flatMap((shot) =>
      (shot.layers ?? []).map((layer) => resolveLayerPath(folderPath, layer.bitmapPath))
    )
  );
  const orphanLayerAssets = (await collectLayerAssetPaths(folderPath)).filter(
    (layerPath) => !referencedLayerAssetPaths.has(layerPath)
  );
  if (orphanLayerAssets.length > 0) {
    throw new Error(`Unreferenced layer assets remain: ${JSON.stringify(orphanLayerAssets)}`);
  }

  return {
    referenced: referencedLayerAssetPaths.size,
    orphaned: orphanLayerAssets.length
  };
};

const topLeftRgb = async (filePath) => {
  const { data } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  return Array.from(data.slice(0, 3));
};

const hasNonTransparentPixels = async (filePath) => {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] > 0) {
      return true;
    }
  }
  return false;
};

const findArchivedFileByHash = async (folderPath, expectedHash) => {
  const archiveRoot = path.join(folderPath, "Archive");
  const batches = await readdir(archiveRoot).catch(() => []);

  for (const batch of batches) {
    const batchPath = path.join(archiveRoot, batch);
    const fileNames = await readdir(batchPath).catch(() => []);
    for (const fileName of fileNames) {
      const candidate = path.join(batchPath, fileName);
      if ((await hashFile(candidate).catch(() => undefined)) === expectedHash) {
        return candidate;
      }
    }
  }

  return undefined;
};

const connectToStoryboardPage = async () => {
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    return pages.find((item) => item.title === "Storyboard Flow" && item.webSocketDebuggerUrl);
  }, "Electron CDP page");

  let nextId = 1;
  const pending = new Map();
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) =>
    send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }).then((result) => result.result.value);

  await send("Runtime.enable");
  await send("Input.setIgnoreInputEvents", { ignore: false });

  return { ws, send, evaluate };
};

const dispatchKeyZ = async (send, modifiers) => {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "z",
    code: "KeyZ",
    windowsVirtualKeyCode: 90,
    modifiers
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "z",
    code: "KeyZ",
    windowsVirtualKeyCode: 90,
    modifiers
  });
};

const dispatchKey = async (send, key, code, windowsVirtualKeyCode) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
};

const dispatchModifiedKey = async (send, key, code, windowsVirtualKeyCode, modifiers) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
};

const waitForUndoReady = async () => {
  await delay(700);
};

const showJapaneseStoryboardSheet = (evaluate) =>
  evaluate(`
    (() => {
      const button = document.querySelector('button[aria-label="Show Japanese storyboard sheet"]');
      button?.click();
      return button?.getAttribute('aria-pressed') === 'true';
    })()
  `);

const showStoryboardBoard = (evaluate) =>
  evaluate(`
    (() => {
      const button = document.querySelector('button[aria-label="Show storyboard board"]');
      button?.click();
      return button?.getAttribute('aria-pressed') === 'true';
    })()
  `);

const dragStroke = async (send, startX, startY, endX, endY, modifiers = 0) => {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y: startY,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers
  });

  for (let index = 1; index <= 12; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(startX + ((endX - startX) * index) / 12),
      y: Math.round(startY + ((endY - startY) * index) / 12),
      button: "left",
      buttons: 1,
      modifiers
    });
  }

  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: endX,
    y: endY,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers
  });
};

const liveBitmapCanvasSnapshot = (evaluate) =>
  evaluate(`
    (async () => {
      const canvas = Array.from(document.querySelectorAll(".live-bitmap-canvas")).find(
        (item) => getComputedStyle(item).display !== "none"
      );
      return canvas ? { dataUrl: canvas.toDataURL("image/png") } : undefined;
    })()
  `);

const dragStrokeWithLiveBitmapPreview = async (send, evaluate, startX, startY, endX, endY) => {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y: startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });

  const liveBefore = await waitFor(
    () => liveBitmapCanvasSnapshot(evaluate),
    "live bitmap canvas visible during eraser"
  );

  for (let index = 1; index <= 6; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(startX + ((endX - startX) * index) / 12),
      y: Math.round(startY + ((endY - startY) * index) / 12),
      button: "left",
      buttons: 1
    });
  }

  await waitFor(async () => {
    const liveAfter = await liveBitmapCanvasSnapshot(evaluate);
    return liveAfter?.dataUrl && liveAfter.dataUrl !== liveBefore.dataUrl ? true : undefined;
  }, "live bitmap canvas changes before eraser mouseup");

  for (let index = 7; index <= 12; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(startX + ((endX - startX) * index) / 12),
      y: Math.round(startY + ((endY - startY) * index) / 12),
      button: "left",
      buttons: 1
    });
  }

  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: endX,
    y: endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
};

const dragWithoutRelease = async (send, startX, startY, endX, endY) => {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y: startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });

  for (let index = 1; index <= 12; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(startX + ((endX - startX) * index) / 12),
      y: Math.round(startY + ((endY - startY) * index) / 12),
      button: "left",
      buttons: 1
    });
  }
};

const releaseMouse = async (send, x, y) => {
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
};

const dragPolyline = async (send, points) => {
  const [start, ...rest] = points;
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });

  for (const point of rest) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1
    });
  }

  const end = rest.at(-1) ?? start;
  await releaseMouse(send, end.x, end.y);
};

let electronProcess;
let storyboardSocket;

try {
  // Fixture setup.
  await mkdir(smokeRoot, { recursive: true });
  await mkdir(scriptRoot, { recursive: true });
  await mkdir(deleteRoot, { recursive: true });
  await mkdir(clipboardRoot, { recursive: true });
  await mkdir(denseMarqueeRoot, { recursive: true });
  const originalShotAPath = path.join(smokeRoot, "shot_a.png");
  const originalShotBPath = path.join(smokeRoot, "shot_b.png");
  const originalShotCPath = path.join(smokeRoot, "shot_c.png");
  const scriptShotAPath = path.join(scriptRoot, "script_a.png");
  const scriptShotBPath = path.join(scriptRoot, "script_b.png");
  const scriptShotCPath = path.join(scriptRoot, "script_c.png");
  const scriptExternalShotAPath = path.join(scriptRoot, "script_external_a.png");
  const scriptExternalShotBPath = path.join(scriptRoot, "script_external_b.png");
  const deleteShotAPath = path.join(deleteRoot, "delete_a.png");
  const deleteShotBPath = path.join(deleteRoot, "delete_b.png");
  const deleteShotCPath = path.join(deleteRoot, "delete_c.png");
  const clipboardShotAPath = path.join(clipboardRoot, "clipboard_a.png");
  const clipboardShotBPath = path.join(clipboardRoot, "clipboard_b.png");
  const clipboardShotCPath = path.join(clipboardRoot, "clipboard_c.png");
  const legacyImagePath = path.join(legacyRoot, "legacy.png");

  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: "#c9dcff"
    }
  })
    .png()
    .toFile(originalShotAPath);
  await sharp({
    create: {
      width: 430,
      height: 180,
      channels: 4,
      background: "#dceeff"
    }
  })
    .png()
    .toFile(originalShotBPath);
  await sharp({
    create: {
      width: 258,
      height: 180,
      channels: 4,
      background: "#ffe8d6"
    }
  })
    .png()
    .toFile(originalShotCPath);
  await copyFile(originalShotAPath, scriptShotAPath);
  await copyFile(originalShotBPath, scriptShotBPath);
  await copyFile(originalShotCPath, scriptShotCPath);
  await copyFile(originalShotAPath, deleteShotAPath);
  await copyFile(originalShotBPath, deleteShotBPath);
  await copyFile(originalShotCPath, deleteShotCPath);
  await copyFile(originalShotAPath, clipboardShotAPath);
  await copyFile(originalShotBPath, clipboardShotBPath);
  await copyFile(originalShotCPath, clipboardShotCPath);
  for (let index = 0; index < 24; index += 1) {
    await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: index % 2 === 0 ? "#eef2ff" : "#fff4d6"
      }
    })
      .png()
      .toFile(path.join(denseMarqueeRoot, `dense_${String(index + 1).padStart(2, "0")}.png`));
  }
  const originalShotAHash = await hashFile(originalShotAPath);

  await mkdir(path.join(legacyRoot, ".storyboard-workbench"), { recursive: true });
  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: "white"
    }
  })
    .png()
    .toFile(legacyImagePath);
  await writeFile(
    projectMetadataPath(legacyRoot),
    JSON.stringify(
      {
        id: "legacy-project",
        name: "Legacy Project",
        naming: { sceneCode: "legacy", artistName: "artist", version: "v001" },
        shots: [
          {
            id: "legacy-shot",
            imagePath: legacyImagePath,
            fileName: "legacy.png",
            order: 0,
            activeLayerTarget: "image",
            activeSketchLayerId: "legacy-ink",
            imageLayerEdits: [
              {
                id: "legacy-image-edit",
                tool: "brush",
                color: "#ff0000",
                opacity: 1,
                size: 24,
                points: [60, 60, 260, 120]
              }
            ],
            sketchLayers: [
              {
                id: "legacy-ink",
                name: "Legacy Ink",
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: "normal",
                order: 0,
                strokes: [
                  {
                    id: "legacy-stroke",
                    tool: "brush",
                    color: "#0000ff",
                    opacity: 1,
                    size: 20,
                    points: [70, 130, 250, 40]
                  }
                ]
              }
            ]
          }
        ],
        dialogues: [],
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z"
      },
      null,
      2
    )
  );

  const electronUserDataRoot = path.join(smokeRoot, ".electron-user-data");
  await mkdir(electronUserDataRoot, { recursive: true });

  electronProcess = spawn(electronBin, [`--remote-debugging-port=${port}`, "."], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SWB_USER_DATA_DIR: electronUserDataRoot,
      SWB_PYTHON_DEPS_DIR: photoshopPythonDepsDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  electronProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  electronProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const { ws, send, evaluate } = await connectToStoryboardPage();
  storyboardSocket = ws;
  await send("Page.enable");
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Page.javascriptDialogOpening") {
      void send("Page.handleJavaScriptDialog", { accept: true });
    }
  });

  const focusChecks = await waitFor(() => evaluate(`(() => {
    if (!document.querySelector('.app-shell')) return undefined;
    return {
      hasAiBridge: Object.prototype.hasOwnProperty.call(window.storyboard, 'ai'),
      aiButtons: document.querySelectorAll('[aria-label="Toggle AI Draft panel"]').length,
      aiPanels: document.querySelectorAll('.ai-draft-panel').length,
      candidateCards: document.querySelectorAll('[data-ai-candidate-id]').length,
      pendingButtons: document.querySelectorAll('[aria-label="Toggle pending sidebar"]').length
    };
  })()`), "focused App exposes ordinary Pending and no AI UI or bridge");
  if (focusChecks.hasAiBridge || focusChecks.aiButtons || focusChecks.aiPanels || focusChecks.candidateCards || focusChecks.pendingButtons !== 1) {
    throw new Error(`AI removal or ordinary Pending entry regressed: ${JSON.stringify(focusChecks)}`);
  }

  // Scenario: open a normal image folder and verify basic rendering.
  const openFolder = async (folderPath = smokeRoot, { waitForMetadata = true, expectOpened = true } = {}) => {
    if (!waitForMetadata && ![scriptRoot, deleteRoot, denseMarqueeRoot, smokeRoot, clipboardRoot, photoshopImportRoot, savedLayeredImportRoot].includes(folderPath)) {
      throw new Error("Only explicitly selected preparations with explicit Import may defer the metadata wait");
    }
    await waitFor(
      () =>
        evaluate(`
          Boolean(document.querySelector('input[aria-label="Folder path"]'))
        `),
      "folder path input"
    );

    await evaluate(`
    (() => {
      const input = document.querySelector('input[aria-label="Folder path"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(folderPath)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value;
    })()
  `);
    await waitFor(
      () =>
        evaluate(`
          document.querySelector('input[aria-label="Folder path"]')?.value ===
            ${JSON.stringify(folderPath)}
        `),
      `folder input value for ${folderPath}`
    );
    await evaluate(`
      document.querySelector('input[aria-label="Folder path"]')?.closest("form")?.requestSubmit()
    `);

    if (!expectOpened) return;

    await waitFor(
      () =>
        evaluate(`
        Boolean(document.querySelector(".image-stage"))
      `),
      "shot stage"
    );

    if (!waitForMetadata) return;

    await waitFor(async () => {
      const project = await readProjectMetadata(folderPath);
      const shotCount = project.shots?.length ?? 0;
      if (shotCount === 0) {
        return undefined;
      }

      const renderedShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
      return renderedShotCount === shotCount ? project : undefined;
    }, `project metadata for ${folderPath}`);
  };

  const exportPhotoshopTiffsViaDebugApi = async (folderPath) => {
    const project = await readProjectMetadata(folderPath);
    await evaluate(`
      window.storyboard.exportPhotoshopTiffs(${JSON.stringify({
        project,
        folderPath,
        metadataPath: projectMetadataPath(folderPath)
      })})
    `);
  };

  await mkdir(mdBootstrapRoot, { recursive: true });
  await mkdir(mdBootstrapTargetRoot, { recursive: true });
  const mdBootstrapSourcePath = path.join(mdBootstrapRoot, "numbered-storyboard.md");
  await writeFile(
    mdBootstrapSourcePath,
    ["# Numbered storyboard", "", "1. Establishing shot", "   Camera glides over the street.", "2. Close on the phone"].join("\n") + "\n",
    "utf8"
  );
  const mdBootstrapInspection = await evaluate(
    `window.storyboard.inspectStoryboardScript(${JSON.stringify(mdBootstrapSourcePath)})`
  );
  if (mdBootstrapInspection.entryCount !== 2 || mdBootstrapInspection.fileName !== "numbered-storyboard.md") {
    throw new Error(`Markdown storyboard inspection failed: ${JSON.stringify(mdBootstrapInspection)}`);
  }
  const mdBootstrapScan = decodeNormalSaveImportResult(await evaluate(
    `window.storyboard.createFromStoryboardScript(${JSON.stringify({
      sourceMarkdownPath: mdBootstrapSourcePath,
      targetFolderPath: mdBootstrapTargetRoot,
      blankShotPreset: "16:9",
      normalSave: true
    })})`
  ));
  if (mdBootstrapScan.folderPath !== mdBootstrapTargetRoot || mdBootstrapScan.images.length !== 2) {
    throw new Error(`Markdown storyboard project scan was incorrect: ${JSON.stringify(mdBootstrapScan)}`);
  }
  const mdBootstrapProject = await readProjectMetadata(mdBootstrapTargetRoot);
  const mdBootstrapScripts = mdBootstrapProject.shots?.map((shot) => shot.scriptText ?? "");
  if (
    mdBootstrapProject.shots?.length !== 2 ||
    mdBootstrapScripts?.[0] !== "Establishing shot\nCamera glides over the street." ||
    mdBootstrapScripts?.[1] !== "Close on the phone"
  ) {
    throw new Error(`Markdown storyboard project metadata was incorrect: ${JSON.stringify(mdBootstrapProject)}`);
  }
  const mdBootstrapMarkdown = await readFile(path.join(mdBootstrapTargetRoot, "storyboard-script.md"), "utf8");
  if (!mdBootstrapMarkdown.includes("1. Establishing shot\n   Camera glides over the street.") ||
    !mdBootstrapMarkdown.includes("2. Close on the phone")) {
    throw new Error(`Markdown storyboard mirror was not written correctly: ${mdBootstrapMarkdown}`);
  }
  mdBootstrapProject.dialogues = [
    {
      id: "matte-dialogue-1",
      shotId: mdBootstrapProject.shots[0].id,
      text: "Dialogue on the expanded matte",
      order: 0
    },
    {
      id: "matte-dialogue-2",
      shotId: mdBootstrapProject.shots[1].id,
      text: "Dialogue on the existing matte",
      order: 0
    }
  ];
  await writeFile(
    projectMetadataPath(mdBootstrapTargetRoot),
    `${JSON.stringify(mdBootstrapProject, null, 2)}\n`,
    "utf8"
  );
  await openFolder(mdBootstrapTargetRoot);
  await waitFor(
    () =>
      evaluate(
        `Boolean(document.querySelector('[data-shot-id="${mdBootstrapProject.shots[0].id}"]'))`
      ),
    "expanded matte storyboard card"
  );
  await evaluate(`document.querySelector('[data-shot-id="${mdBootstrapProject.shots[0].id}"]')?.click()`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('button[aria-label="Configure storyboard matte"]')?.disabled === false`
      ),
    "expanded matte storyboard controls"
  );
  await evaluate(`document.querySelector('button[aria-label="Configure storyboard matte"]')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector(".matte-menu"))`),
    "storyboard matte menu"
  );
  await evaluate(`
    Array.from(document.querySelectorAll(".matte-menu button"))
      .find((button) => button.textContent?.includes("Expand canvas"))
      ?.click()
  `);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    const shots = matteProject.shots ?? [];
    return shots.length === 2 &&
      shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1230 &&
          shot.presentation?.matte?.mode === "expanded" &&
          shot.layers?.at(-1)?.id === "layer-matte-overlay" &&
          shot.layers.at(-1)?.locked === true
      )
      ? shots
      : undefined;
  }, "scene-wide expanded storyboard matte metadata");
  const expandedSceneProject = await readProjectMetadata(mdBootstrapTargetRoot);
  const expandedMatteLayer = expandedSceneProject.shots[0].layers.find(
    (layer) => layer.id === "layer-matte-overlay"
  );
  const expandedImageLayer = expandedSceneProject.shots[0].layers.find(
    (layer) => layer.id === "layer-image"
  );
  const expandedMattePath = path.join(mdBootstrapTargetRoot, expandedMatteLayer.bitmapPath);
  const expandedImagePath = path.join(mdBootstrapTargetRoot, expandedImageLayer.bitmapPath);
  const expandedMattePixels = await sharp(expandedMattePath).ensureAlpha().raw().toBuffer();
  const expandedImagePixels = await sharp(expandedImagePath).ensureAlpha().raw().toBuffer();
  const expandedPixelOffset = (x, y) => (y * 1920 + x) * 4;
  const matteTopOffset = expandedPixelOffset(10, 10);
  const matteCenterOffset = expandedPixelOffset(10, 200);
  const matteBottomOffset = expandedPixelOffset(10, 1220);
  const imageTopOffset = expandedPixelOffset(10, 10);
  const imageContentOffset = expandedPixelOffset(10, 75);
  if (
    expandedMattePixels[matteTopOffset] !== 0 ||
    expandedMattePixels[matteTopOffset + 3] !== 255 ||
    expandedMattePixels[matteCenterOffset + 3] !== 0 ||
    expandedMattePixels[matteBottomOffset] !== 0 ||
    expandedMattePixels[matteBottomOffset + 3] !== 255 ||
    expandedImagePixels[imageTopOffset + 3] !== 0 ||
    expandedImagePixels[imageContentOffset + 3] !== 255
  ) {
    throw new Error("Expanded scene matte was not isolated on a transparent locked overlay");
  }
  await evaluate(`document.querySelector('button[aria-label="Place dialogue on lower matte"]')?.click()`);
  const expandedDialogueShots = await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    const shots = matteProject.shots ?? [];
    return shots.length === 2 &&
      shots.every((shot) =>
        shot.layers?.some((layer) => layer.id === "layer-dialogue-overlay")
      )
      ? shots
      : undefined;
  }, "scene-wide expanded matte dialogue overlays");
  const expandedMatteShot = expandedDialogueShots.find(
    (item) => item.id === mdBootstrapProject.shots[0].id
  );
  const dialogueOverlayPath = path.join(
    mdBootstrapTargetRoot,
    expandedMatteShot.layers.find((layer) => layer.id === "layer-dialogue-overlay").bitmapPath
  );
  const dialogueOverlayMetadata = await sharp(dialogueOverlayPath).metadata();
  if (dialogueOverlayMetadata.width !== 1920 || dialogueOverlayMetadata.height !== 1230) {
    throw new Error(
      `Expanded matte dialogue layer dimensions were incorrect: ${JSON.stringify(dialogueOverlayMetadata)}`
    );
  }
  if (
    expandedMatteShot.layers.at(-2)?.id !== "layer-matte-overlay" ||
    expandedMatteShot.layers.at(-1)?.id !== "layer-dialogue-overlay"
  ) {
    throw new Error("Dialogue overlay was not kept above the locked matte overlay");
  }
  await evaluate(`document.querySelector('button[aria-label="Place dialogue on lower matte"]')?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    return matteProject.shots?.length === 2 &&
      matteProject.shots.every(
        (shot) => !shot.layers?.some((layer) => layer.id === "layer-dialogue-overlay")
      );
  }, "scene-wide dialogue overlays disabled");
  await evaluate(`document.querySelector('button[aria-label="Place dialogue on lower matte"]')?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    return matteProject.shots?.length === 2 &&
      matteProject.shots.every((shot) =>
        shot.layers?.some((layer) => layer.id === "layer-dialogue-overlay")
      );
  }, "scene-wide dialogue overlays re-enabled");
  await evaluate(`document.querySelector('button[aria-label="Configure storyboard matte"]')?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    const shots = matteProject.shots ?? [];
    return shots.length === 2 &&
      shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1080 &&
          !shot.presentation?.matte &&
          !shot.layers?.some(
            (layer) =>
              layer.id === "layer-matte-overlay" ||
              layer.id === "layer-dialogue-overlay"
          )
      )
      ? shots
      : undefined;
  }, "scene-wide expanded matte disabled");
  if (
    (await fileExists(expandedMattePath)) ||
    (await fileExists(dialogueOverlayPath))
  ) {
    throw new Error("Turning off expanded matte did not remove system layer assets");
  }
  const collapsedImageMetadata = await sharp(expandedImagePath).metadata();
  if (collapsedImageMetadata.width !== 1920 || collapsedImageMetadata.height !== 1080) {
    throw new Error(
      `Expanded matte did not restore image dimensions: ${JSON.stringify(collapsedImageMetadata)}`
    );
  }

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    return matteProject.shots?.length === 2 &&
      matteProject.shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1230 &&
          shot.presentation?.matte?.mode === "expanded" &&
          shot.layers?.some((layer) => layer.id === "layer-matte-overlay")
      )
      ? matteProject
      : undefined;
  }, "expanded matte disable undo");
  if (
    !(await fileExists(expandedMattePath)) ||
    !(await fileExists(dialogueOverlayPath))
  ) {
    throw new Error("Undo did not restore matte and dialogue assets");
  }

  await dispatchKeyZ(send, 12);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdBootstrapTargetRoot);
    return matteProject.shots?.length === 2 &&
      matteProject.shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1080 &&
          !shot.presentation?.matte &&
          !shot.layers?.some(
            (layer) =>
              layer.id === "layer-matte-overlay" ||
              layer.id === "layer-dialogue-overlay"
          )
      )
      ? matteProject
      : undefined;
  }, "expanded matte disable redo");

  await mkdir(mdEmbeddedMatteTargetRoot, { recursive: true });
  const embeddedMatteScan = decodeNormalSaveImportResult(await evaluate(
    `window.storyboard.createFromStoryboardScript(${JSON.stringify({
      sourceMarkdownPath: mdBootstrapSourcePath,
      targetFolderPath: mdEmbeddedMatteTargetRoot,
      blankShotPreset: "16:9",
      normalSave: true
    })})`
  ));
  const embeddedMatteProject = await readProjectMetadata(mdEmbeddedMatteTargetRoot);
  if (
    embeddedMatteScan.folderPath !== mdEmbeddedMatteTargetRoot ||
    embeddedMatteProject.shots?.length !== 2
  ) {
    throw new Error("Existing-matte scene bootstrap was incorrect");
  }
  const embeddedOriginalShotIds = new Set(
    embeddedMatteProject.shots.map((shot) => shot.id)
  );
  await openFolder(mdEmbeddedMatteTargetRoot);
  await waitFor(
    () =>
      evaluate(
        `Boolean(document.querySelector('[data-shot-id="${embeddedMatteProject.shots[0].id}"]'))`
      ),
    "existing matte storyboard card"
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('button[aria-label="Configure storyboard matte"]')?.disabled === false`
      ),
    "existing matte storyboard controls"
  );
  await evaluate(`document.querySelector('button[aria-label="Configure storyboard matte"]')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector(".matte-menu"))`),
    "existing scene matte menu"
  );
  await evaluate(`
    Array.from(document.querySelectorAll(".matte-menu button"))
      .find((button) => button.textContent?.includes("Use existing matte"))
      ?.click()
  `);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdEmbeddedMatteTargetRoot);
    const shots = matteProject.shots ?? [];
    return shots.length === 2 &&
      shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1080 &&
          shot.presentation?.matte?.mode === "embedded" &&
          shot.layers?.at(-1)?.id === "layer-matte-overlay"
      )
      ? shots
      : undefined;
  }, "scene-wide embedded storyboard matte metadata");
  await evaluate(`document.querySelector('button[aria-label="Place dialogue on lower matte"]')?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdEmbeddedMatteTargetRoot);
    return matteProject.shots?.length === 2 &&
      matteProject.shots.every((shot) =>
        shot.layers?.some((layer) => layer.id === "layer-dialogue-overlay")
      );
  }, "embedded scene dialogue overlays enabled");
  await evaluate(`document.querySelector(".add-shot-main-button")?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdEmbeddedMatteTargetRoot);
    const inheritedShot = matteProject.shots?.find(
      (shot) => !embeddedOriginalShotIds.has(shot.id)
    );
    return matteProject.shots?.length === 3 &&
      inheritedShot?.swb?.canvasHeight === 1080 &&
      inheritedShot.presentation?.matte?.mode === "embedded" &&
      inheritedShot.layers?.at(-2)?.id === "layer-matte-overlay" &&
      inheritedShot.layers?.at(-1)?.id === "layer-dialogue-overlay"
      ? inheritedShot
      : undefined;
  }, "new storyboard inherited embedded scene matte and dialogue overlay");
  await evaluate(`document.querySelector('button[aria-label="Configure storyboard matte"]')?.click()`);
  await waitFor(async () => {
    const matteProject = await readProjectMetadata(mdEmbeddedMatteTargetRoot);
    const shots = matteProject.shots ?? [];
    return shots.length === 3 &&
      shots.every(
        (shot) =>
          shot.swb?.canvasHeight === 1080 &&
          !shot.presentation?.matte &&
          !shot.layers?.some(
            (layer) =>
              layer.id === "layer-matte-overlay" ||
              layer.id === "layer-dialogue-overlay"
          )
      )
      ? shots
      : undefined;
  }, "scene-wide embedded matte disabled");

  await showJapaneseStoryboardSheet(evaluate);
  const mdBootstrapUiScript = await waitFor(
    () => evaluate(`document.querySelector('[aria-label="Shot 001 action notes"]')?.value ?? ""`),
    "markdown storyboard action notes"
  );
  if (mdBootstrapUiScript !== "Establishing shot\nCamera glides over the street.") {
    throw new Error(`Markdown storyboard UI did not open imported script text: ${mdBootstrapUiScript}`);
  }

  // This fixture remains three original PNGs until the actual normal UI Import.
  // Read-only observation of committed React props/refs binds preview and publication
  // to the current folder; no production state, API, writer or admission is replaced.
  const scriptRootUiFacts = (observedFolder = scriptRoot) => evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll('[data-shot-id]'));
      const element = cards[0];
      const key = element && Object.keys(element).find(k => k.startsWith('__reactFiber$'));
      let fiber = key && element[key];
      if (!fiber) return;
      while (fiber.return) fiber = fiber.return;
      fiber = fiber.stateNode.current;
      const stack = [fiber], shots = new Map();
      let currentProject;
      while (stack.length) {
        const node = stack.pop(), props = node.memoizedProps;
        if (props?.shot && props.folderPath === ${JSON.stringify(observedFolder)}) shots.set(props.shot.id, props.shot);
        for (let hook = node.memoizedState; hook && Object.hasOwn(hook, 'memoizedState'); hook = hook.next) {
          const project = hook.memoizedState?.current;
          if (Array.isArray(project?.shots) && project.shots.length === cards.length &&
              project.shots.every(s => s.imagePath.startsWith(${JSON.stringify(observedFolder + path.sep)}))) currentProject = project;
        }
        if (node.child) stack.push(node.child);
        if (node.sibling) stack.push(node.sibling);
      }
      return {
        shots: cards.map(card => shots.get(card.getAttribute('data-shot-id'))),
        pendingBake: currentProject?.pendingBake,
        projectObserved: Boolean(currentProject),
        previews: cards.map(card => {
          const stage = card.querySelector('.image-stage');
          const imgs = Array.from(stage?.querySelectorAll('img') ?? []);
          const canvases = Array.from(stage?.querySelectorAll('canvas') ?? []);
          return imgs.some(img => img.complete && img.naturalWidth > 0) || canvases.some(canvas => {
            const context = canvas.getContext('2d');
            return context && canvas.width > 0 && canvas.height > 0 &&
              context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] > 0;
          });
        }),
        visibleCards: cards.map(card => { const rect = card.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; }),
        importEnabled: Boolean(document.querySelector('.import-control button') && !document.querySelector('.import-control button').disabled),
        importWarning: Boolean(document.querySelector('.import-warning')),
        status: document.querySelector('.status-panel > span')?.textContent ?? ''
      };
    })()
  `);
  await mkdir(scriptRootImportEvidenceRoot, { recursive: true });
  const scriptOriginalPaths = [scriptShotAPath, scriptShotBPath, scriptShotCPath];
  const scriptOriginalFacts = await Promise.all(scriptOriginalPaths.map(async imagePath => {
    const bytes = await readFile(imagePath);
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { imagePath, fileName: path.basename(imagePath), hash: createHash('sha256').update(bytes).digest('hex'),
      width: info.width, height: info.height, pixelHash: createHash('sha256').update(data).digest('hex') };
  }));
  await writeFile(path.join(scriptRootImportEvidenceRoot, 'originals.json'), JSON.stringify(scriptOriginalFacts, null, 2));
  await openFolder(scriptRoot, { waitForMetadata: false });
  await showStoryboardBoard(evaluate);
  const scriptPreImportUi = await waitFor(async () => {
    const facts = await scriptRootUiFacts();
    await writeFile(path.join(scriptRootImportEvidenceRoot, 'readiness-last.json'), JSON.stringify({ facts: facts ?? null }, null, 2));
    return facts?.projectObserved && facts.shots.length === 3 && facts.shots.every((shot, i) =>
      shot?.imagePath === scriptOriginalPaths[i]) && facts.previews.every(Boolean) &&
      facts.importEnabled && facts.importWarning ? facts : undefined;
  }, "pristine scriptRoot current folder, three original previews and reachable Import");
  await evaluate(`document.querySelector('button[aria-label="Workspace status"]')?.click()`);
  const scriptPreImportStatus = (await scriptRootUiFacts()).status;
  const scriptPreImportEntries = Object.values(scriptPreImportUi.pendingBake?.shots ?? {});
  const scriptPreImportRootFiles = await readdir(scriptRoot);
  const scriptPreImportHashes = await Promise.all(scriptOriginalPaths.map(hashFile));
  const scriptPreImportMetadataAbsent = !await fileExists(projectMetadataPath(scriptRoot));
  const scriptPreImportEvidence = { ui: scriptPreImportUi, status: scriptPreImportStatus,
    rootFiles: scriptPreImportRootFiles, originalHashes: scriptPreImportHashes,
    metadataAbsent: scriptPreImportMetadataAbsent,
    noSyncedIdentity: scriptPreImportEntries.every(entry => entry.state !== 'synced' && !entry.acceptedOutputIdentity),
    noSavedSuccess: !/^Saved\b/i.test(scriptPreImportStatus) };
  await writeFile(path.join(scriptRootImportEvidenceRoot, 'pre-import.json'), JSON.stringify(scriptPreImportEvidence, null, 2));
  if (!scriptPreImportMetadataAbsent || !scriptPreImportEvidence.noSyncedIdentity || !scriptPreImportEvidence.noSavedSuccess ||
      scriptPreImportHashes.some((hash, i) => hash !== scriptOriginalFacts[i].hash) ||
      scriptPreImportRootFiles.some(name => /\.tiff?$/i.test(name) || name === 'Archive') ||
      await fileExists(scriptExternalShotAPath) || await fileExists(scriptExternalShotBPath)) {
    throw new Error("Pristine scriptRoot was altered, falsely certified or external fixtures were prepared before explicit UI Import");
  }
  await evaluate(`document.querySelector('button[aria-label="Workspace status"]')?.click()`);
  await evaluate(`document.querySelector('.import-control button').click()`);
  const scriptInitialImportedProject = await waitFor(async () => {
    const project = await readProjectMetadata(scriptRoot);
    const ui = await scriptRootUiFacts();
    const markdown = await readFile(path.join(scriptRoot, 'storyboard-script.md'), 'utf8');
    return project.shots?.length === 3 && project.shots.every((shot, i) => shot.id === scriptPreImportUi.shots[i].id &&
      shot.swb?.status === 'owned' && /\.tiff?$/i.test(shot.imagePath)) &&
      ui?.shots.length === 3 && ui.shots.every((shot, i) => shot?.imagePath === project.shots[i].imagePath) &&
      !ui.importWarning && !ui.importEnabled && markdown === '1. \n2. \n3. \n' ? project : undefined;
  }, "scriptRoot normal UI Import required JSON/MD, three owned TIFFs and publication");
  const scriptInitialImportMappings = await Promise.all(scriptInitialImportedProject.shots.map(async (shot, i) => {
    const original = scriptOriginalFacts[i], entry = scriptInitialImportedProject.pendingBake?.shots[shot.id];
    const archivePath = shot.swb.archivePath;
    const output = await sharp(shot.imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const outputPixelHash = createHash('sha256').update(output.data).digest('hex');
    const archiveHash = await hashFile(archivePath), outputHash = await hashFile(shot.imagePath);
    const layerPaths = (shot.layers ?? []).map(layer => path.resolve(scriptRoot, layer.bitmapPath));
    if (shot.sourceFileName !== original.fileName || shot.swb.sourcePath !== original.imagePath ||
        path.dirname(path.dirname(archivePath)) !== path.join(scriptRoot, 'Archive') ||
        path.basename(archivePath) !== original.fileName || archiveHash !== original.hash ||
        await fileExists(original.imagePath) || path.dirname(shot.imagePath) !== scriptRoot ||
        shot.fileName !== path.basename(shot.imagePath) || shot.order !== i ||
        output.info.width !== original.width || output.info.height !== original.height || outputPixelHash !== original.pixelHash ||
        entry?.state !== 'pending' || typeof entry.editToken !== 'string' || !entry.editToken ||
        entry.acceptedOutputIdentity !== outputHash || !layerPaths.length ||
        !(await Promise.all(layerPaths.map(fileExists))).every(Boolean)) {
      throw new Error(`scriptRoot Import source/archive/output/identity mapping failed for ${original.fileName}`);
    }
    return { shotId: shot.id, order: shot.order, sourceFileName: shot.sourceFileName, sourcePath: shot.swb.sourcePath,
      archivePath, archiveHash, imagePath: shot.imagePath, fileName: shot.fileName, outputHash, outputPixelHash,
      width: output.info.width, height: output.info.height, layerPaths, state: entry.state };
  }));
  await writeFile(path.join(scriptRootImportEvidenceRoot, 'post-import.json'), JSON.stringify({
    metadataPath: projectMetadataPath(scriptRoot), markdownPath: path.join(scriptRoot, 'storyboard-script.md'),
    mappings: scriptInitialImportMappings, ui: await scriptRootUiFacts()
  }, null, 2));

  // Scenario: Japanese storyboard Action field and root markdown sync/import.
  const scriptMarkdownPath = path.join(scriptRoot, "storyboard-script.md");
  await showJapaneseStoryboardSheet(evaluate);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.japanese-storyboard-view [aria-label="Shot 001 action notes"]'))`),
    "Japanese storyboard Action field visible"
  );
  const scriptCellGeometry = await evaluate(`
    (() => Array.from(document.querySelectorAll(".japanese-storyboard-row")).map((row) => {
      const rowRect = row.getBoundingClientRect();
      const textareaRect = row.querySelector('[aria-label$="action notes"]')?.getBoundingClientRect();
      return {
        shotId: row.getAttribute("data-shot-id"),
        rowBottom: rowRect.bottom,
        textareaBottom: textareaRect?.bottom ?? null,
        textareaWithinRow: textareaRect ? textareaRect.bottom <= rowRect.bottom + 1 : false
      };
    }))()
  `);
  if (scriptCellGeometry.some((item) => !item.textareaWithinRow)) {
    throw new Error(`Action textarea overflowed Japanese storyboard row bounds: ${JSON.stringify(scriptCellGeometry)}`);
  }
  await evaluate(`
    (() => {
      const textarea = document.querySelector('[aria-label="Shot 001 action notes"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, "Opening shot\\nCamera pushes in");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return textarea.value;
    })()
  `);
  const scriptBackMetadata = await waitFor(async () => {
    const project = await readProjectMetadata(scriptRoot);
    return project.shots?.[0]?.scriptText === "Opening shot\nCamera pushes in" ? project : undefined;
  }, "storyboard script metadata autosave");
  const scriptMarkdownWritten = await waitFor(async () => {
    const contents = await readFile(scriptMarkdownPath, "utf8").catch(() => "");
    return contents.includes("1. Opening shot\n   Camera pushes in") ? contents : undefined;
  }, "storyboard script markdown autosave");

  await writeFile(
    scriptMarkdownPath,
    ["1. New exterior beat", "2. Opening shot", "   Camera pushes in", "3. ", "4. "].join("\n") + "\n",
    "utf8"
  );
  await evaluate(`window.dispatchEvent(new Event("focus"))`);
  await waitFor(
    () => evaluate(`!document.querySelector(".import-control button").disabled`),
    "storyboard script import enabled"
  );
  await evaluate(`document.querySelector(".import-warning").click()`);
  const importHelpText = await waitFor(
    () => evaluate(`document.querySelector(".import-help-popover")?.textContent ?? ""`),
    "import help popover"
  );
  if (
    !importHelpText.includes("为什么需要 Import？") ||
    !importHelpText.includes("storyboard-script.md") ||
    !importHelpText.includes("Storyboard Flow") ||
    !importHelpText.includes("Save")
  ) {
    throw new Error(`Import help popover copy was incomplete: ${importHelpText}`);
  }
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitFor(
    () => evaluate(`!document.querySelector(".import-help-popover")`),
    "import help popover closed"
  );
  await evaluate(`document.querySelector(".import-control button").click()`);
  const scriptImportedProject = await waitFor(async () => {
    const project = await readProjectMetadata(scriptRoot);
    const scripts = project.shots?.map((shot) => shot.scriptText ?? "");
    return project.shots?.length === 4 &&
      scripts?.[0] === "New exterior beat" &&
      scripts?.[1] === "Opening shot\nCamera pushes in"
      ? project
      : undefined;
  }, "storyboard script markdown import");
  const scriptMarkdownAfterImport = await readFile(scriptMarkdownPath, "utf8");
  if (!scriptMarkdownAfterImport.includes("3. \n4. \n")) {
    throw new Error(`Storyboard script markdown empty items missed marker spaces: ${scriptMarkdownAfterImport}`);
  }
  await waitFor(
    () => evaluate(`!document.querySelector(".import-warning")`),
    "import warning hidden after storyboard script import"
  );
  const scriptBackChecks = {
    metadataText: scriptBackMetadata.shots[0].scriptText,
    markdownWritten: scriptMarkdownWritten.includes("1. Opening shot\n   Camera pushes in"),
    importedScripts: scriptImportedProject.shots.map((shot) => shot.scriptText ?? ""),
    importedFileNames: scriptImportedProject.shots.map((shot) => shot.fileName),
    markdownAfterImport: scriptMarkdownAfterImport
  };
  await evaluate(`document.querySelector('[aria-label="Shot 001 action notes"]')?.focus()`);
  await dispatchKey(send, "Backspace", "Backspace", 8);
  const deleteInScriptTextareaKeptCards = await evaluate(
    `document.querySelectorAll("[data-shot-id]").length`
  );
  if (deleteInScriptTextareaKeptCards !== scriptImportedProject.shots.length) {
    throw new Error("Delete inside Japanese storyboard Action field removed a storyboard card");
  }
  await copyFile(originalShotBPath, scriptExternalShotAPath);
  await copyFile(originalShotCPath, scriptExternalShotBPath);
  await evaluate(`window.dispatchEvent(new Event("focus"))`);
  await waitFor(async () => {
    const importEnabled = await evaluate(`!document.querySelector(".import-control button").disabled`);
    const warningVisible = await evaluate(`Boolean(document.querySelector(".import-warning"))`);
    const renderedShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
    return importEnabled &&
      warningVisible &&
      renderedShotCount === scriptImportedProject.shots.length + 2
      ? true
      : undefined;
  }, "external folder images trigger import warning");
  await evaluate(`document.querySelector(".import-control button").click()`);
  const externalImageWarningProject = await waitFor(async () => {
    const project = await readProjectMetadata(scriptRoot);
    return project.shots?.length === scriptImportedProject.shots.length + 2 &&
      project.shots.slice(-2).every((shot) => shot.swb?.status === "owned")
      ? project
      : undefined;
  }, "external folder images import");
  await showStoryboardBoard(evaluate);

  // These three call sites already explicitly Import; only their opening wait changes.
  const rawOriginals = new Map();
  const rawOpenBeforeExplicitImport = async (folder, count) => {
    const paths = (await readdir(folder)).filter(name => /\.png$/i.test(name)).sort().map(name => path.join(folder, name));
    if (paths.length !== count) throw new Error(`Unexpected original PNG count in ${folder}`);
    const originals = await Promise.all(paths.map(async imagePath => ({ imagePath, hash: await hashFile(imagePath) })));
    await openFolder(folder, { waitForMetadata: false });
    await showStoryboardBoard(evaluate);
    const ui = await waitFor(async () => {
      const facts = await scriptRootUiFacts(folder);
      await writeFile(path.join(scriptRootImportEvidenceRoot, `${path.basename(folder)}-readiness.json`), JSON.stringify(facts ?? null, null, 2));
      return facts?.projectObserved && facts.shots.length === count && facts.shots.every(shot => paths.includes(shot?.imagePath)) &&
        facts.importEnabled && facts.importWarning && facts.previews.some(Boolean) &&
        facts.previews.every((ready, i) => ready || !facts.visibleCards[i]) ? facts : undefined;
    }, `raw preview and original explicit Import reachable for ${folder}`);
    const hashes = await Promise.all(paths.map(hashFile)), names = await readdir(folder);
    const metadataAbsent = !await fileExists(projectMetadataPath(folder));
    const entries = Object.values(ui.pendingBake?.shots ?? {});
    await writeFile(path.join(scriptRootImportEvidenceRoot, `${path.basename(folder)}-pre-import.json`), JSON.stringify({ originals, hashes, names, metadataAbsent, ui }, null, 2));
    if (!metadataAbsent || entries.length || hashes.some((hash, i) => hash !== originals[i].hash) ||
        names.some(name => /\.tiff?$/i.test(name) || name === 'Archive')) throw new Error(`Raw originals altered or certified before explicit Import in ${folder}`);
    rawOriginals.set(folder, { originals, ui });
  };
  const verifyOriginalExplicitImport = async folder => {
    const { originals, ui: beforeUi } = rawOriginals.get(folder);
    const project = await readProjectMetadata(folder);
    const ui = await waitFor(async () => {
      const facts = await scriptRootUiFacts(folder);
      return facts?.shots.length === project.shots.length && facts.shots.every((shot, i) => shot?.imagePath === project.shots[i].imagePath) &&
        !facts.importEnabled && !facts.importWarning ? facts : undefined;
    }, `original explicit Import publication for ${folder}`);
    const mappings = await Promise.all(project.shots.map(async (shot, i) => {
      const original = originals.find(o => o.imagePath === shot.swb?.sourcePath);
      const entry = project.pendingBake?.shots[shot.id], archivePath = shot.swb?.archivePath;
      const archiveHash = await hashFile(archivePath), outputHash = await hashFile(shot.imagePath);
      if (!original || shot.id !== beforeUi.shots[i].id || shot.order !== i || shot.sourceFileName !== path.basename(original.imagePath) ||
          path.dirname(path.dirname(archivePath)) !== path.join(folder, 'Archive') || archiveHash !== original.hash ||
          await fileExists(original.imagePath) || shot.swb.status !== 'owned' || !/\.tiff?$/i.test(shot.imagePath) ||
          path.dirname(shot.imagePath) !== folder || shot.fileName !== path.basename(shot.imagePath) ||
          entry?.state !== 'pending' || !entry.editToken || entry.acceptedOutputIdentity !== outputHash) throw new Error(`Original explicit Import mapping failed in ${folder}`);
      return { shotId: shot.id, sourcePath: original.imagePath, sourceFileName: shot.sourceFileName, archivePath, archiveHash, imagePath: shot.imagePath, outputHash };
    }));
    const markdown = await readFile(path.join(folder, 'storyboard-script.md'), 'utf8');
    if (project.shots.length !== originals.length || markdown !== project.shots.map((_, i) => `${i + 1}. \n`).join('')) throw new Error(`Original explicit Import required MD/count failed in ${folder}`);
    await writeFile(path.join(scriptRootImportEvidenceRoot, `${path.basename(folder)}-post-import.json`), JSON.stringify({ mappings, ui, markdown }, null, 2));
  };

  // Scenario: Delete removes selected storyboards in the app, Undo restores them, and Save moves files to Trash.
  await rawOpenBeforeExplicitImport(deleteRoot, 3);
  await waitFor(
    () => evaluate(`!document.querySelector(".import-control button")?.disabled`),
    "delete smoke import button enabled"
  );
  await evaluate(`document.querySelector(".import-control button").click()`);
  await waitFor(async () => {
    const project = await readProjectMetadata(deleteRoot);
    return project.shots?.length === 3 &&
      project.shots.every((shot) => shot.swb?.status === "owned")
      ? project
      : undefined;
  }, "delete smoke imported images before editing");
  await verifyOriginalExplicitImport(deleteRoot);
  const deleteInitialProject = await readProjectMetadata(deleteRoot);
  const deleteTargetPath = deleteInitialProject.shots[1].imagePath;
  const deleteTargetLayerDir = path.join(
    deleteRoot,
    ".storyboard-workbench",
    "layers",
    deleteInitialProject.shots[1].id
  );
  await mkdir(deleteTargetLayerDir, { recursive: true });
  await writeFile(path.join(deleteTargetLayerDir, "orphan-candidate.png"), "orphan candidate");
  const deleteLayerDirExistsBeforeDelete = await fileExists(deleteTargetLayerDir);
  await evaluate(`
    (() => {
      document.querySelectorAll("[data-shot-id]")[1].click();
      return true;
    })()
  `);
  await dispatchKey(send, "Backspace", "Backspace", 8);
  const deletePendingProject = await waitFor(async () => {
    const project = await readProjectMetadata(deleteRoot);
    return project.shots?.length === 2 && project.pendingDeletedShots?.length === 1
      ? project
      : undefined;
  }, "Delete key pending deletion autosave");
  if (!(await fileExists(deleteTargetPath))) {
    throw new Error("Delete moved the storyboard file before Save");
  }
  const deleteLayerDirExistsBeforeSave = await fileExists(deleteTargetLayerDir);
  if (!deleteLayerDirExistsBeforeSave) {
    throw new Error("Delete removed the storyboard layer directory before Save");
  }

  await dispatchKeyZ(send, 4);
  await waitFor(async () => {
    const project = await readProjectMetadata(deleteRoot);
    return project.shots?.length === 3 && !project.pendingDeletedShots?.length
      ? project
      : undefined;
  }, "Delete undo restored project");
  if (!(await fileExists(deleteTargetPath))) {
    throw new Error("Undo delete did not keep the storyboard file in place");
  }
  const deleteLayerDirExistsAfterUndo = await fileExists(deleteTargetLayerDir);
  if (!deleteLayerDirExistsAfterUndo) {
    throw new Error("Undo delete did not keep the storyboard layer directory in place");
  }

  await evaluate(`
    (() => {
      document.querySelectorAll("[data-shot-id]")[1].click();
      return true;
    })()
  `);
  await dispatchKey(send, "Backspace", "Backspace", 8);
  await waitFor(async () => {
    const project = await readProjectMetadata(deleteRoot);
    return project.shots?.length === 2 && project.pendingDeletedShots?.length === 1
      ? project
      : undefined;
  }, "Delete key pending deletion after undo");
  await evaluate(`
    (() => {
      const saveButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Save");
      saveButton.click();
      return true;
    })()
  `);
  const deleteSavedProject = await waitFor(async () => {
    const project = await readProjectMetadata(deleteRoot);
    return project.shots?.length === 2 &&
      !project.pendingDeletedShots?.length &&
      !(await fileExists(deleteTargetPath)) &&
      !(await fileExists(deleteTargetLayerDir))
      ? project
      : undefined;
  }, "Save moved deleted storyboard file to Trash", 20000);

  // Scenario: dense-board marquee stays outside cards and edge-scrolls during drag.
  await rawOpenBeforeExplicitImport(denseMarqueeRoot, 24);
  await waitFor(
    () => evaluate(`!document.querySelector(".import-control button")?.disabled`),
    "dense marquee import button enabled"
  );
  await evaluate(`document.querySelector(".import-control button").click()`);
  await waitFor(async () => {
    const project = await readProjectMetadata(denseMarqueeRoot);
    return project.shots?.length === 24 &&
      project.shots.every((shot) => shot.swb?.status === "owned")
      ? project
      : undefined;
  }, "dense marquee imported images before editing");
  await verifyOriginalExplicitImport(denseMarqueeRoot);
  await evaluate(`
    (() => {
      const input = document.querySelector('input[type="range"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "50");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const boardScroll = document.querySelector(".workspace-board-scroll");
      if (boardScroll) {
        boardScroll.scrollTo(0, 0);
      } else {
        window.scrollTo(0, 0);
      }
      return true;
    })()
  `);
  await delay(200);
  const denseMarqueeStart = await evaluate(`
    (() => {
      const cards = Array.from(document.querySelectorAll("[data-shot-id]"));
      const first = cards[0].getBoundingClientRect();
      const visibleCards = cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
      const lastVisible = visibleCards.at(-1).getBoundingClientRect();
      return {
        cardX: Math.round(first.left + first.width / 2),
        cardY: Math.round(first.top + 16),
        outsideX: Math.round(first.left - 8),
        outsideY: Math.round(first.top + 16),
        endX: Math.round(lastVisible.right),
        endY: window.innerHeight - 12
      };
    })()
  `);
  await dragStroke(
    send,
    denseMarqueeStart.cardX,
    denseMarqueeStart.cardY,
    denseMarqueeStart.endX,
    denseMarqueeStart.endY
  );
  const denseCardOriginSelectedCount = await evaluate(`
    Number(document.querySelector("footer span:last-child")?.textContent?.match(/\\d+/)?.[0] ?? 0)
  `);
  if (denseCardOriginSelectedCount > 1) {
    throw new Error(`Card-origin marquee selected shots unexpectedly: ${denseCardOriginSelectedCount}`);
  }
  await dragWithoutRelease(
    send,
    denseMarqueeStart.outsideX,
    denseMarqueeStart.outsideY,
    denseMarqueeStart.endX,
    denseMarqueeStart.endY
  );
  await delay(500);
  const denseMarqueeDuringDrag = await evaluate(`
    ({
      scrollY: document.querySelector(".workspace-board-scroll")?.scrollTop ?? window.scrollY,
      selectedCount: Number(
        document.querySelector(".selection-marquee")?.dataset.selectedCount ??
        document.querySelector("footer span:last-child")?.textContent?.match(/\\d+/)?.[0] ??
        0
      ),
      marqueeVisible: Boolean(document.querySelector(".selection-marquee"))
    })
  `);
  await releaseMouse(send, denseMarqueeStart.endX, denseMarqueeStart.endY);
  if (
    denseMarqueeDuringDrag.scrollY <= 0 ||
    denseMarqueeDuringDrag.selectedCount < 6 ||
    !denseMarqueeDuringDrag.marqueeVisible
  ) {
    throw new Error(`Dense marquee edge-scroll failed: ${JSON.stringify(denseMarqueeDuringDrag)}`);
  }
  await evaluate(`
    (() => {
      const input = document.querySelector('input[type="range"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "100");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const boardScroll = document.querySelector(".workspace-board-scroll");
      if (boardScroll) {
        boardScroll.scrollTo(0, 0);
      } else {
        window.scrollTo(0, 0);
      }
      return true;
    })()
  `);

  await rawOpenBeforeExplicitImport(smokeRoot, 3);
  await waitFor(
    () => evaluate(`!document.querySelector(".import-control button")?.disabled`),
    "main smoke import button enabled"
  );
  await evaluate(`document.querySelector(".import-control button").click()`);
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.length === 3 &&
      project.shots.every((shot) => shot.swb?.status === "owned")
      ? project
      : undefined;
  }, "main smoke imported images before editing");
  await verifyOriginalExplicitImport(smokeRoot);

		  // Scenario: drawing, erasing, undo/redo, layer drawer, and shortcuts.
	  const exportTiffButtonVisible = await evaluate(`
	    Array.from(document.querySelectorAll("button"))
      .some((button) => button.textContent.trim() === "Export TIFF")
  `);
	  if (exportTiffButtonVisible) {
	    throw new Error("Export TIFF button should not be visible in the main window");
	  }
	  await evaluate(`document.querySelector('[aria-label="Save naming options"]').click()`);
	  const saveMenuBounds = await waitFor(
	    () => evaluate(`
	      (() => {
	        const menu = document.querySelector(".save-menu");
	        if (!menu) return undefined;
	        const rect = menu.getBoundingClientRect();
	        return {
	          left: rect.left,
	          right: rect.right,
	          top: rect.top,
	          bottom: rect.bottom,
	          windowWidth: window.innerWidth,
	          windowHeight: window.innerHeight
	        };
	      })()
	    `),
	    "save menu bounds"
	  );
	  if (
	    saveMenuBounds.left < 0 ||
	    saveMenuBounds.right > saveMenuBounds.windowWidth ||
	    saveMenuBounds.top < 0 ||
	    saveMenuBounds.bottom > saveMenuBounds.windowHeight
	  ) {
	    throw new Error(`Save menu is outside the app window: ${JSON.stringify(saveMenuBounds)}`);
		  }
		  await evaluate(`document.querySelector('[aria-label="Save naming options"]').click()`);
		  await evaluate(`
		    (() => {
		      const zoom = document.querySelector('input[type="range"]');
		      zoom.value = "25";
		      zoom.dispatchEvent(new Event("input", { bubbles: true }));
		      zoom.dispatchEvent(new Event("change", { bubbles: true }));
		      return true;
		    })()
		  `);
		  await waitFor(
		    () => evaluate(`document.querySelector(".app-shell")?.classList.contains("is-animation-mode") === false`),
		    "parking smoke grid mode"
		  );

		  await evaluate(`
		    (() => {
	      const cards = document.querySelectorAll("[data-shot-id]");
	      cards[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	      cards[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
	      return true;
	    })()
	  `);
  await waitFor(
    () => evaluate(`document.querySelectorAll(".shot-card.is-selected").length === 2`),
    "parking smoke selected two storyboards"
  );
		  await evaluate(`document.querySelector('[aria-label="Toggle pending sidebar"]').click()`);
		  await waitFor(
		    () => evaluate(`document.querySelector(".parking-shelf")?.classList.contains("is-open")`),
		    "parking shelf open before first park"
		  );
		  const parkDrag = await evaluate(`
		    (() => {
		      const card = document.querySelectorAll("[data-shot-id]")[1];
		      const head = card.querySelector(".shot-head").getBoundingClientRect();
		      const shelf = document.querySelector(".parking-panel")?.getBoundingClientRect();
		      return {
		        startX: Math.round(head.left + head.width / 2),
		        startY: Math.round(head.top + head.height / 2),
		        endX: Math.round(shelf.left + shelf.width / 2),
		        endY: Math.round(shelf.top + shelf.height / 2)
		      };
		    })()
		  `);
	  await dragStroke(send, parkDrag.startX, parkDrag.startY, parkDrag.endX, parkDrag.endY);
	  const parkingAfterPark = await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const pendingPaths = project.parkedShots?.map((shot) => shot.imagePath) ?? [];
	    const pendingFilesVisible =
	      pendingPaths.length === 2 &&
	      pendingPaths.every(
	        (imagePath) =>
	          path.dirname(imagePath) === path.join(smokeRoot, "Pending")
	      ) &&
	      (await Promise.all(pendingPaths.map(fileExists))).every(Boolean);
	    const shelfOpen = await evaluate(`document.querySelector(".parking-shelf")?.classList.contains("is-open")`);
	    const boardShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
	    const parkedCardCount = await evaluate(`document.querySelectorAll("[data-parked-shot-id]").length`);
	    if (
	      project.shots?.length === 1 &&
	      project.parkedShots?.length === 2 &&
	      !project.pendingDeletedShots?.length &&
	      shelfOpen &&
	      boardShotCount === 1 &&
	      parkedCardCount === 2 &&
	      pendingFilesVisible
	    ) {
	      return {
	        parkedCount: project.parkedShots.length,
	        boardShotCount,
	        parkedCardCount,
	        noPendingDelete: true,
	        pendingFilesVisible
	      };
	    }
	    throw new Error(JSON.stringify({
	      shots: project.shots?.length,
	      parkedShots: project.parkedShots?.length ?? 0,
	      pendingDeletedShots: project.pendingDeletedShots?.length ?? 0,
	      shelfOpen,
	      boardShotCount,
	      parkedCardCount,
	      pendingFilesVisible
	    }));
	  }, "storyboards parked in right shelf");
	  await waitFor(async () => {
	    const layout = await evaluate(`
	      (() => {
	        const shelf = document.querySelector(".parking-shelf");
	        const workspace = document.querySelector(".workspace-layout");
	        const toolbar = document.querySelector(".toolbar");
	        if (!shelf || !workspace) return null;
	        const shelfRect = shelf.getBoundingClientRect();
	        const workspaceRect = workspace.getBoundingClientRect();
	        const toolbarRect = toolbar?.getBoundingClientRect();
	        return {
	          shelfOpen: shelf.classList.contains("is-open"),
	          shellReserved: document.querySelector(".app-shell")?.classList.contains("has-parking-shelf-open"),
	          workspaceRight: Math.round(workspaceRect.right),
	          shelfLeft: Math.round(shelfRect.left),
	          toolbarRight: toolbarRect ? Math.round(toolbarRect.right) : 0,
	          windowRight: Math.round(window.innerWidth)
	        };
	      })()
	    `);
	    return layout?.shelfOpen &&
	      layout?.shellReserved &&
	      layout.workspaceRight <= layout.shelfLeft + 1 &&
	      layout.toolbarRight > layout.shelfLeft
	      ? layout
	      : undefined;
	  }, "parking shelf opens from toolbar without covering workspace");
	  await delay(200);
	  await evaluate(`
	    (() => {
	      const card = document.querySelector("[data-parked-shot-id]");
	      const rect = card.getBoundingClientRect();
	      const target = document.querySelector("[data-shot-id]").getBoundingClientRect();
	      return {
	        startX: Math.round(rect.left + rect.width / 2),
	        startY: Math.round(rect.top + rect.height / 2),
	        endX: Math.round(target.left + target.width / 2),
	        endY: Math.round(target.top + target.height / 2)
	      };
	    })()
	  `).then((restoreDrag) => dragStroke(send, restoreDrag.startX, restoreDrag.startY, restoreDrag.endX, restoreDrag.endY));
	  await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    return project.shots?.length === 2 && project.parkedShots?.length === 1
	      ? project
	      : undefined;
	  }, "first parked storyboard restored");
		  const parkingAfterRestore = await waitFor(async () => {
		    const project = await readProjectMetadata(smokeRoot);
		    const remainingPendingPath = project.parkedShots?.[0]?.imagePath;
		    const restoredPathsAreRootFiles = project.shots?.every(
		      (shot) => path.dirname(shot.imagePath) === smokeRoot
		    );
		    const selectedCount = await evaluate(`document.querySelectorAll(".shot-card.is-selected, .shot-card.is-animation-focus").length`);
		    return project.shots?.length === 2 &&
		      project.parkedShots?.length === 1 &&
		      path.dirname(remainingPendingPath) === path.join(smokeRoot, "Pending") &&
		      restoredPathsAreRootFiles
		      ? {
		          restoredCount: project.shots.length,
		          remainingParkedCount: project.parkedShots.length,
		          selectedCount,
		          restoredPathsAreRootFiles
		        }
		      : undefined;
		  }, "parked storyboard restored to board");
		  const parkingWhilePinnedOpen = {
		    shelfStayedOpen: true,
		    parkedCount: parkingAfterPark.parkedCount
		  };
		  await evaluate(`
		    (() => {
		      const card = document.querySelector("[data-parked-shot-id]");
		      const rect = card.getBoundingClientRect();
		      const target = document.querySelector("[data-shot-id]").getBoundingClientRect();
		      return {
		        startX: Math.round(rect.left + rect.width / 2),
		        startY: Math.round(rect.top + rect.height / 2),
		        endX: Math.round(target.left + target.width / 2),
		        endY: Math.round(target.top + target.height / 2)
		      };
		    })()
		  `).then((restoreDrag) => dragStroke(send, restoreDrag.startX, restoreDrag.startY, restoreDrag.endX, restoreDrag.endY));
		  await waitFor(async () => {
		    const project = await readProjectMetadata(smokeRoot);
		    const pendingFiles = await readdir(path.join(smokeRoot, "Pending")).catch(() => []);
		    if (
		      project.shots?.length === 3 &&
		      !project.parkedShots?.length &&
		      project.shots.every((shot) => path.dirname(shot.imagePath) === smokeRoot) &&
		      !pendingFiles.some((fileName) => /\.(tif|tiff)$/i.test(fileName))
		    ) {
		      return project;
		    }
		    throw new Error(JSON.stringify({
		      shots: project.shots?.length,
		      parked: project.parkedShots?.length ?? 0
		    }));
		  }, "parking scenario reset by restoring all parked storyboards");
		  await evaluate(`
		    (() => {
		      const zoom = document.querySelector('input[type="range"]');
		      zoom.value = "100";
		      zoom.dispatchEvent(new Event("input", { bubbles: true }));
		      zoom.dispatchEvent(new Event("change", { bubbles: true }));
		      return true;
		    })()
		  `);
		  await waitFor(
		    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "100%"`),
		    "parking smoke zoom reset"
		  );

  // Clipboard preparation alone adds one real UI Import; never auto-Import other folders.
  await rawOpenBeforeExplicitImport(clipboardRoot, 3);
  const clipboardOriginalPixels = await Promise.all(rawOriginals.get(clipboardRoot).originals.map(async original => {
    const { data, info } = await sharp(original.imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { ...original, width: info.width, height: info.height, pixelHash: createHash("sha256").update(data).digest("hex") };
  }));
  await evaluate(`document.querySelector(".import-control button").click()`);
  await waitFor(async () => {
    const project = await readProjectMetadata(clipboardRoot);
    return project.shots?.length === 3 && project.shots.every(shot => shot.swb?.status === "owned") ? project : undefined;
  }, "clipboard explicit Import durable owned TIFF/JSON");
  await verifyOriginalExplicitImport(clipboardRoot);
  const clipboardImported = await readProjectMetadata(clipboardRoot);
  const clipboardProtectedAssets = [];
  for (const shot of clipboardImported.shots) {
    const original = clipboardOriginalPixels.find(item => item.imagePath === shot.swb.sourcePath);
    const { data, info } = await sharp(shot.imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!original || info.width !== original.width || info.height !== original.height ||
        createHash("sha256").update(data).digest("hex") !== original.pixelHash) throw new Error("Clipboard Import changed original dimensions/pixels");
    for (const assetPath of [shot.swb.archivePath, shot.imagePath, ...shot.layers.map(layer => resolveLayerPath(clipboardRoot, layer.bitmapPath))]) {
      clipboardProtectedAssets.push({ assetPath, hash: await hashFile(assetPath) });
    }
  }
  const verifyClipboardAssets = async phase => {
    const project = await readProjectMetadata(clipboardRoot);
    const copied = project.shots.filter(shot => !clipboardImported.shots.some(source => source.id === shot.id));
    const source = clipboardImported.shots[0];
    if (copied.length !== 1) throw new Error("Clipboard copy did not create exactly one independent shot");
    const target = copied[0], pairs = [[source.imagePath, target.imagePath]];
    if (target.layers.length !== source.layers.length) throw new Error("Clipboard layer count differs from actual source");
    for (let i = 0; i < source.layers.length; i++) {
      const a = resolveLayerPath(clipboardRoot, source.layers[i].bitmapPath), b = resolveLayerPath(clipboardRoot, target.layers[i].bitmapPath);
      if (!a.startsWith(path.join(clipboardRoot, ".storyboard-workbench", "layers") + path.sep) ||
          !b.startsWith(path.join(clipboardRoot, ".storyboard-workbench", "layers", target.id) + path.sep)) throw new Error("Clipboard layers borrowed Archive/source namespace");
      pairs.push([a, b]);
    }
    const identities = await Promise.all(pairs.map(async ([a, b]) => {
      const [sa, sb, ha, hb] = await Promise.all([stat(a), stat(b), hashFile(a), hashFile(b)]);
      if (a === b || (sa.dev === sb.dev && sa.ino === sb.ino) || ha !== hb || path.dirname(target.imagePath) !== clipboardRoot ||
          !/\.tiff?$/i.test(target.imagePath)) throw new Error("Clipboard assets alias or do not match active TIFF/internal layers");
      return { sourcePath: a, targetPath: b, sourceInode: sa.ino, targetInode: sb.ino, hash: ha };
    }));
    for (const asset of clipboardProtectedAssets) if (await hashFile(asset.assetPath) !== asset.hash) throw new Error(`Clipboard original asset changed: ${asset.assetPath}`);
    await writeFile(path.join(scriptRootImportEvidenceRoot, `clipboard-${phase}-provenance.json`), JSON.stringify({ originals: clipboardOriginalPixels, protectedAssets: clipboardProtectedAssets, identities }, null, 2));
  };
  const clipboardProjectLoaded = await waitFor(async () => {
    const project = await readProjectMetadata(clipboardRoot);
    const boardShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
    return project.shots?.length === 3 && boardShotCount === 3 ? project : undefined;
  }, "clipboard smoke project loaded");
  const storyboardCopyPasteBefore = await readProjectMetadata(clipboardRoot);
  await evaluate(`
    (() => {
      document.querySelectorAll("[data-shot-id]")[0].click();
      document.body.tabIndex = -1;
      document.body.focus();
      return true;
    })()
  `);
  await dispatchModifiedKey(send, "c", "KeyC", 67, 4);
  await dispatchModifiedKey(send, "v", "KeyV", 86, 4);
  const storyboardPasteChecks = await waitFor(async () => {
    const project = await readProjectMetadata(clipboardRoot);
    const boardShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
    if (
      project.shots?.length === storyboardCopyPasteBefore.shots.length + 1 &&
      boardShotCount === project.shots.length
    ) {
      return { beforeCount: storyboardCopyPasteBefore.shots.length, afterCount: project.shots.length };
    }
    throw new Error(JSON.stringify({
      expectedShots: storyboardCopyPasteBefore.shots.length + 1,
      actualShots: project.shots?.length,
      boardShotCount
    }));
  }, "storyboard keyboard copy paste");
  await verifyClipboardAssets("after-copy");
  const altDragBefore = await readProjectMetadata(clipboardRoot);
  const altDrag = await evaluate(`
    (() => {
      const cards = document.querySelectorAll("[data-shot-id]");
      const source = cards[1].querySelector(".shot-head").getBoundingClientRect();
      const target = cards[cards.length - 1].querySelector(".shot-head").getBoundingClientRect();
      return {
        movingShotId: cards[1].dataset.shotId,
        startX: Math.round(source.left + source.width / 2),
        startY: Math.round(source.top + source.height / 2),
        endX: Math.round(target.right - 4),
        endY: Math.round(target.top + target.height / 2)
      };
    })()
  `);
  await dragStroke(send, altDrag.startX, altDrag.startY, altDrag.endX, altDrag.endY, 1);
  const altDragNoCopyChecks = await waitFor(async () => {
    const project = await readProjectMetadata(clipboardRoot);
    const beforeOrder = altDragBefore.shots.map((shot) => shot.id).join(",");
    const afterOrder = project.shots.map((shot) => shot.id).join(",");
    if (
      project.shots?.length === altDragBefore.shots.length &&
      project.shots.some((shot) => shot.id === altDrag.movingShotId)
    ) {
      return { countUnchanged: true, movingShotStillPresent: true, beforeOrder, afterOrder };
    }
    throw new Error(JSON.stringify({
      beforeOrder,
      afterOrder,
      expectedCount: altDragBefore.shots.length,
      actualCount: project.shots?.length,
      movingShotStillPresent: project.shots.some((shot) => shot.id === altDrag.movingShotId)
    }));
  }, "Option drag does not copy storyboards");
  await verifyClipboardAssets("after-option-drag");
  await openFolder(smokeRoot);
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const boardShotCount = await evaluate(`document.querySelectorAll("[data-shot-id]").length`);
    return project.shots?.length === 3 && boardShotCount === 3 ? project : undefined;
  }, "main smoke project restored after clipboard smoke");

		  const activeStage = await waitFor(
		    () => evaluate(`
		      (() => {
		        const konva = document.querySelector(".konvajs-content");
		        const stage = konva?.closest(".image-stage");
		        const shot = stage?.closest("[data-shot-id]");
		        if (!stage || !shot?.dataset.shotId) {
		          return undefined;
		        }
		        const rect = stage.getBoundingClientRect();
		        return {
		          shotId: shot.dataset.shotId,
		          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
		        };
		      })()
		    `),
		    "active drawing stage"
		  );
		  const layerPath = await waitFor(
		    () => findActiveShotLayerMetadataPathById(smokeRoot, activeStage.shotId),
		    "active image layer metadata path"
		  );
		  await evaluate(`document.querySelector('button[aria-label="Brush"]')?.click()`);
		  await waitFor(
		    () => evaluate(`document.querySelector('button[aria-label="Brush"]')?.classList.contains("selected")`),
		    "brush tool active before drawing smoke"
		  );
		  await waitFor(
		    async () => {
		      const state = await evaluate(`
		        ({
		          locked: Boolean(document.querySelector(".workspace-import-lock")),
		          importWarning: Boolean(document.querySelector(".import-warning")),
		          lockText: document.querySelector(".workspace-import-lock")?.textContent ?? "",
		          status: document.querySelector(".status-popover")?.textContent ?? ""
		        })
		      `);
		      if (!state.locked) {
		        return state;
		      }
		      throw new Error(JSON.stringify(state));
		    },
		    "workspace unlocked before drawing smoke"
		  );
  const secondShotLayerPath = await waitFor(() => findShotLayerMetadataPath(smokeRoot, 1), "second shot image layer metadata path");
  const thirdShotLayerPath = await waitFor(() => findShotLayerMetadataPath(smokeRoot, 2), "third shot image layer metadata path");
  const beforeHash = await layerAssetState(layerPath);
  const secondShotBeforeHash = await layerAssetState(secondShotLayerPath);
  const thirdShotBeforeHash = await layerAssetState(thirdShotLayerPath);

	  let rect = activeStage.rect;
  const sketchSettingsIgnoredOutsideStage = await evaluate(`
    (() => {
      const topbar = document.querySelector(".topbar");
      const rect = topbar.getBoundingClientRect();
      topbar.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 20,
        clientY: rect.top + 20
      }));
      return !document.querySelector(".radial-tool-menu");
    })()
  `);
  if (!sketchSettingsIgnoredOutsideStage) {
    throw new Error("Sketch settings menu opened outside the stage");
  }
  const sketchSettingsOpensOnStage = await waitFor(
    () =>
      evaluate(`
        (() => {
          const stage = document.querySelector(".image-stage");
          const rect = stage.getBoundingClientRect();
          stage.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          }));
          return Boolean(document.querySelector(".radial-tool-menu"));
        })()
      `),
    "sketch settings menu opens on stage"
  );
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitFor(
    () => evaluate(`!document.querySelector(".radial-tool-menu")`),
    "sketch settings menu closed after stage check"
  );

  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "z",
    code: "KeyZ",
    windowsVirtualKeyCode: 90
  });
  const zoomBeforeWheel = await evaluate(`document.querySelector(".bottom-bar span")?.textContent`);
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
    deltaX: 0,
    deltaY: -120
  });
  const zoomAfterWheel = await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "105%"`),
    "stage wheel zoom in"
  );
  if (zoomBeforeWheel !== "100%" || !zoomAfterWheel) {
    throw new Error(`Stage wheel zoom failed: ${zoomBeforeWheel}`);
  }
  await evaluate(`
    (() => {
      const slider = document.querySelector('.bottom-bar input[type="range"]');
      const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      rangeSetter.call(slider, "100");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "100%"`),
    "stage wheel zoom reset"
  );
  const blankZoomPoint = await evaluate(`
    (() => {
      const board = document.querySelector(".board-grid")?.getBoundingClientRect();
      const shots = Array.from(document.querySelectorAll(".shot-card")).map((shot) => shot.getBoundingClientRect());
      if (!board) {
        return null;
      }
      for (let y = board.top + 12; y < board.bottom - 12; y += 20) {
        for (let x = board.left + 12; x < board.right - 12; x += 20) {
          const hitsShot = shots.some((shot) => x >= shot.left && x <= shot.right && y >= shot.top && y <= shot.bottom);
          if (!hitsShot) {
            return { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
      return null;
    })()
  `);
  if (!blankZoomPoint) {
    throw new Error("No blank board area available for wheel zoom smoke");
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: blankZoomPoint.x,
    y: blankZoomPoint.y,
    deltaX: 0,
    deltaY: -120
  });
  await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "105%"`),
    "blank board wheel zoom in"
  );
  await evaluate(`
    (() => {
      const slider = document.querySelector('.bottom-bar input[type="range"]');
      const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      rangeSetter.call(slider, "100");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "100%"`),
    "blank board wheel zoom reset"
  );
  const zDragZoomRect = await waitFor(
    () =>
      evaluate(`
        (() => {
          const stage = document.querySelector(".image-stage")?.getBoundingClientRect();
          return stage
            ? { x: stage.x, y: stage.y, width: stage.width, height: stage.height }
            : undefined;
        })()
      `),
    "stage rect before Z drag zoom"
  );
  const zDragStartX = Math.round(zDragZoomRect.x + zDragZoomRect.width / 2);
  const zDragStartY = Math.round(zDragZoomRect.y + zDragZoomRect.height / 2);
  await dragStroke(send, zDragStartX, zDragStartY, zDragStartX + 30, zDragStartY);
  const zDragZoomedIn = await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "115%"`),
    "Z drag zoom in"
  );
  const zDragZoomOutRect = await waitFor(
    () =>
      evaluate(`
        (() => {
          const stage = document.querySelector(".image-stage")?.getBoundingClientRect();
          return stage
            ? { x: stage.x, y: stage.y, width: stage.width, height: stage.height }
            : undefined;
        })()
      `),
    "stage rect before reverse Z drag zoom"
  );
  const zDragOutStartX = Math.round(zDragZoomOutRect.x + zDragZoomOutRect.width / 2);
  const zDragOutStartY = Math.round(zDragZoomOutRect.y + zDragZoomOutRect.height / 2);
  await dragStroke(send, zDragOutStartX, zDragOutStartY, zDragOutStartX - 30, zDragOutStartY);
  const zDragZoomedOut = await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "100%"`),
    "Z drag zoom out"
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "z",
    code: "KeyZ",
    windowsVirtualKeyCode: 90
  });
  const zDragPreservedLayer = (await layerAssetState(layerPath)) === beforeHash;
  const zDragZoomChecks = {
    drawingPreserved: zDragPreservedLayer,
    zoomedIn: Boolean(zDragZoomedIn),
    zoomedOut: Boolean(zDragZoomedOut)
  };
  if (!Object.values(zDragZoomChecks).every(Boolean)) {
    throw new Error(`Z drag zoom failed: ${JSON.stringify(zDragZoomChecks)}`);
  }
  const storyboardOrderBeforeJapanesePan = await evaluate(`
    Array.from(document.querySelectorAll(".shot-card")).map((shot) => shot.dataset.shotId)
  `);
  await evaluate(`
    (() => {
      document.activeElement?.blur?.();
      window.getSelection()?.removeAllRanges();
      document.querySelector('button[aria-label="Show Japanese storyboard sheet"]')?.click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector(".japanese-storyboard-view"))`),
    "Japanese storyboard view before Space pan"
  );
  await evaluate(`
    (() => {
      const slider = document.querySelector('.bottom-bar input[type="range"]');
      const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      rangeSetter.call(slider, "180");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar span")?.textContent === "180%"`),
    "Japanese storyboard zoom before Space pan"
  );
  const japaneseSpacePanStart = await waitFor(
    () =>
      evaluate(`
        (() => {
          const scroll = document.querySelector(".workspace-board-scroll");
          const canvas = document.querySelector(".japanese-storyboard-picture .konvajs-content");
          if (!scroll || !canvas || scroll.scrollHeight <= scroll.clientHeight) {
            return undefined;
          }
          scroll.scrollTop = 0;
          const rect = canvas.getBoundingClientRect();
          return {
            before: scroll.scrollTop,
            maxScrollTop: scroll.scrollHeight - scroll.clientHeight,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        })()
      `),
    "scrollable Japanese storyboard Picture canvas"
  );
  const japanesePanStartX = Math.round(
    japaneseSpacePanStart.rect.x + japaneseSpacePanStart.rect.width / 2
  );
  const japanesePanStartY = Math.round(
    japaneseSpacePanStart.rect.y + japaneseSpacePanStart.rect.height / 2
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32
  });
  await dragStroke(
    send,
    japanesePanStartX,
    japanesePanStartY,
    japanesePanStartX,
    japanesePanStartY - 100
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32
  });
  const japaneseSpacePanScrolled = await waitFor(
    () =>
      evaluate(`
        (() => {
          const scroll = document.querySelector(".workspace-board-scroll");
          return scroll && scroll.scrollTop > ${japaneseSpacePanStart.before}
            ? scroll.scrollTop
            : undefined;
        })()
      `),
    "Japanese storyboard Space pan scroll"
  );
  await delay(300);
  const japaneseStoryboardOrderAfterPan = await evaluate(`
    Array.from(document.querySelectorAll(".japanese-storyboard-row")).map((shot) => shot.dataset.shotId)
  `);
  const japaneseSpacePanChecks = {
    drawingPreserved: (await layerAssetState(layerPath)) === beforeHash,
    orderPreserved:
      JSON.stringify(japaneseStoryboardOrderAfterPan) ===
      JSON.stringify(storyboardOrderBeforeJapanesePan),
    panStateCleaned: await evaluate(
      `!document.querySelector(".workspace-board-scroll")?.classList.contains("is-space-panning")`
    ),
    scrolled: japaneseSpacePanScrolled > japaneseSpacePanStart.before,
    textSelectionPreserved: await evaluate(`window.getSelection()?.toString() === ""`)
  };
  if (!Object.values(japaneseSpacePanChecks).every(Boolean)) {
    throw new Error(
      `Japanese storyboard Space pan failed: ${JSON.stringify(japaneseSpacePanChecks)}`
    );
  }
  await evaluate(`
    (() => {
      const scroll = document.querySelector(".workspace-board-scroll");
      if (scroll) {
        scroll.scrollTop = 0;
      }
      const slider = document.querySelector('.bottom-bar input[type="range"]');
      const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      rangeSetter.call(slider, "100");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector('button[aria-label="Show storyboard board"]')?.click();
      return true;
    })()
  `);
  await waitFor(
    () =>
      evaluate(`
        document.querySelector(".bottom-bar span")?.textContent === "100%" &&
        Boolean(document.querySelector(".board-grid"))
      `),
    "storyboard view restored after Japanese Space pan"
  );
  rect = await waitFor(
    () =>
      evaluate(`
        (() => {
          const stage = document.querySelector(".image-stage")?.getBoundingClientRect();
          return stage
            ? { x: stage.x, y: stage.y, width: stage.width, height: stage.height }
            : undefined;
        })()
      `),
    "stage rect before drawing"
  );
  const startX = Math.round(rect.x + rect.width * 0.35);
  const startY = Math.round(rect.y + rect.height * 0.45);
  const endX = Math.round(rect.x + rect.width * 0.65);
  const endY = Math.round(rect.y + rect.height * 0.55);

  await dragStroke(send, startX, startY, endX, endY);

  const drawnHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash !== beforeHash ? nextHash : undefined;
  }, "layer hash change after drawing");

  await dispatchKeyZ(send, 4);

  const undoHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash === beforeHash ? nextHash : undefined;
  }, "layer hash restore after undo");

  await delay(500);
  await dispatchKeyZ(send, 12);

  const redoHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after redo");

  const keyboardShortcutChecks = await waitFor(
    async () => {
      const opened = await evaluate(`
        (() => {
          if (!document.querySelector(".shortcut-menu")) {
            document.querySelector('button[aria-label="Keyboard shortcuts"]')?.click();
          }
          const shortcuts = Array.from(document.querySelectorAll(".shortcut-field")).map((field) => ({
            label: field.querySelector("span")?.textContent,
            value: field.querySelector("kbd")?.textContent
          }));
          return {
            hasMenu: Boolean(document.querySelector(".shortcut-menu")),
            inputCount: document.querySelectorAll(".shortcut-menu input").length,
            hasSettingsApi:
              "getKeyboardShortcuts" in window.storyboard || "setKeyboardShortcuts" in window.storyboard,
            brush: shortcuts.find((shortcut) => shortcut.label === "Brush")?.value,
            clearLayer: shortcuts.find((shortcut) => shortcut.label === "Clear layer")?.value
          };
        })()
      `);
      if (!opened?.hasMenu || opened.inputCount !== 0 || opened.hasSettingsApi) {
        return undefined;
      }
      const settingsFileExists = Boolean(
        await readFile(path.join(electronUserDataRoot, "keyboard-shortcuts.json"), "utf8").catch(() => undefined)
      );
      if (settingsFileExists || opened.brush !== "B" || opened.clearLayer !== "Escape") {
        return undefined;
      }
      await evaluate(`
        (() => {
          document.activeElement?.blur();
          document.querySelector('button[aria-label="Keyboard shortcuts"]')?.click();
          document.body.tabIndex = -1;
          document.body.focus();
          return true;
        })()
      `);
      return {
        menuOpened: opened.hasMenu,
        inputCount: opened.inputCount,
        hasSettingsApi: opened.hasSettingsApi,
        brush: opened.brush,
        clearLayer: opened.clearLayer,
        settingsFileExists
      };
    },
    "keyboard shortcut list"
  );

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Eraser"]').click();
      return true;
    })()
  `);

  await dragStrokeWithLiveBitmapPreview(send, evaluate, endX, endY, startX, startY);

  const erasedHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash !== drawnHash ? nextHash : undefined;
  }, "layer hash change after eraser");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const undoEraseHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after undo eraser");

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Clear current layer"]').click();
      return true;
    })()
  `);

  const clearedHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash !== drawnHash ? nextHash : undefined;
  }, "layer hash change after clear");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const undoClearHash = await waitFor(async () => {
    const nextHash = await layerAssetState(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after undo clear");

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      return true;
    })()
  `);

  await waitFor(
    async () => {
      const checks = await evaluate(`
        (() => {
          const firstShot = document.querySelector('[data-shot-id]');
          const stageRect = firstShot?.querySelector('.image-stage')?.getBoundingClientRect();
          const dialogueRect = firstShot?.querySelector('.dialogue-zone')?.getBoundingClientRect();
          const panelRect = firstShot?.querySelector('.shot-layer-popover .layer-panel')?.getBoundingClientRect();
          const toggle = firstShot?.querySelector('.shot-layer-popover button[aria-label="Toggle shot layers"]');
          const toggleRect = toggle?.getBoundingClientRect();
          const footerButtonRect = firstShot
            ?.querySelector('.layer-panel-footer button[aria-label="Add layer"]')
            ?.getBoundingClientRect();
          const mergeVisibleRect = firstShot
            ?.querySelector('.layer-panel-footer button[aria-label="Merge visible layers"]')
            ?.getBoundingClientRect();
          const mergeRect = firstShot
            ?.querySelector('.layer-panel-footer button[aria-label="Merge"]')
            ?.getBoundingClientRect();
          const deleteRect = firstShot
            ?.querySelector('.layer-panel-footer button[aria-label="Delete current layer"]')
            ?.getBoundingClientRect();
          const checks = {
            hasDelete: Boolean(firstShot?.querySelector('.shot-layer-popover button[aria-label="Delete current layer"]')),
            noFixedPopover: !document.body.querySelector(':scope > .layer-popover'),
            hasRects: Boolean(stageRect && dialogueRect && panelRect && toggleRect && footerButtonRect && mergeVisibleRect && mergeRect && deleteRect),
            panelAligned: Boolean(stageRect && panelRect && panelRect.left >= stageRect.right - 1),
	            panelBottomAligned: Boolean(dialogueRect && panelRect && Math.abs(panelRect.bottom - dialogueRect.bottom) <= 5),
            toggleAttachedToPanelRight: Boolean(panelRect && toggleRect && Math.abs(toggleRect.left - panelRect.right) <= 1),
            toggleBottomAligned: Boolean(stageRect && toggleRect && Math.abs(toggleRect.bottom - stageRect.bottom) <= 1),
            toggleVertical: Boolean(toggleRect && toggleRect.height > toggleRect.width),
            footerCompact: Boolean(footerButtonRect && footerButtonRect.height <= 20),
            mergeButtonsOnLeft: Boolean(mergeVisibleRect && mergeRect && footerButtonRect && mergeVisibleRect.left < mergeRect.left && mergeRect.right < footerButtonRect.left),
            addDeleteOnRight: Boolean(footerButtonRect && deleteRect && footerButtonRect.left < deleteRect.left),
            noBlendSelect: !firstShot.querySelector('select[aria-label="Layer blend mode"]'),
            noOpacitySlider: !firstShot.querySelector('input[aria-label="Active layer opacity"]'),
            hasBlendDot: Boolean(firstShot.querySelector('button[aria-label="Layer blend mode: normal"]')),
            toggleEmpty: toggle?.textContent.trim() === "",
            panelBottomDelta: dialogueRect && panelRect ? panelRect.bottom - dialogueRect.bottom : null,
            toggleBottomDelta: stageRect && toggleRect ? toggleRect.bottom - stageRect.bottom : null
          };
          const result = { ...checks };
          delete result.panelBottomDelta;
          delete result.toggleBottomDelta;
          return Object.values(result).every(Boolean) ? true : checks;
        })()
      `);
      if (checks !== true) {
        throw new Error(JSON.stringify(checks));
      }
      return true;
    },
    "inline shot layer panel delete button"
  );

  const dialogueRowChecks = await waitFor(
    () =>
      evaluate(`
        (async () => {
          const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const zone = document.querySelector('[data-shot-id] .dialogue-zone');
          if (!zone) {
            return undefined;
          }
          const emptyZoneHeight = zone.getBoundingClientRect().height;
          zone.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          for (let index = 0; index < 20 && !zone.querySelector("textarea"); index += 1) {
            await delay(50);
          }
          const textarea = zone.querySelector("textarea");
          if (!textarea) {
            return undefined;
          }
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          valueSetter.call(textarea, "One line");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          await delay(100);
          const oneLineRows = textarea.rows;
          const oneLineHeight = textarea.getBoundingClientRect().height;
          const oneLineZoneHeight = zone.getBoundingClientRect().height;
          valueSetter.call(textarea, ["One", "Two", "Three", "Four"].join("\\n"));
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          await delay(100);
          return {
            emptyZoneHeight,
            oneLineRows,
            oneLineHeight,
            oneLineZoneHeight,
            clampedRows: textarea.rows,
            clampedValue: textarea.value,
            clampedLineCount: textarea.value.split("\\n").length,
            clampedHeight: textarea.getBoundingClientRect().height
          };
        })()
      `),
    "dialogue textarea row clamp"
  );
  if (
    dialogueRowChecks.oneLineRows !== 1 ||
    dialogueRowChecks.oneLineZoneHeight > dialogueRowChecks.emptyZoneHeight + 2 ||
    dialogueRowChecks.clampedRows !== 3 ||
    dialogueRowChecks.clampedLineCount !== 3 ||
    dialogueRowChecks.clampedValue !== "One\nTwo\nThree" ||
    dialogueRowChecks.clampedHeight <= dialogueRowChecks.oneLineHeight
  ) {
    throw new Error(`Dialogue row clamp failed: ${JSON.stringify(dialogueRowChecks)}`);
  }

  const imageOnlyDeleteDisabled = await evaluate(`
    document.querySelector('button[aria-label="Delete current layer"]').disabled
  `);
  if (!imageOnlyDeleteDisabled) {
    throw new Error("Image-only layer delete button should be disabled");
  }

  await waitFor(
    () =>
      evaluate(`
        (() => {
          const popover = document.querySelector('.shot-layer-popover');
          return Boolean(popover && popover.getAnimations().every((animation) => animation.playState !== "running"));
        })()
      `),
    "initial layer panel open animation settled"
  );
  const layerPanelPlacement = await evaluate(`
    (() => {
      const stage = document.querySelector('[data-shot-id] .image-stage')?.getBoundingClientRect();
      const panel = document.querySelector('.shot-layer-popover .layer-panel')?.getBoundingClientRect();
      const toggle = document
        .querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]')
        ?.getBoundingClientRect();
      return {
        stageRight: stage?.right ?? null,
        panelLeft: panel?.left ?? null,
        panelRight: panel?.right ?? null,
        toggleLeft: toggle?.left ?? null,
        panelStartsAfterStage: Boolean(stage && panel && panel.left >= stage.right - 1),
        toggleAttachedToPanelRight: Boolean(panel && toggle && Math.abs(toggle.left - panel.right) <= 1)
      };
    })()
  `);
  if (!layerPanelPlacement.panelStartsAfterStage || !layerPanelPlacement.toggleAttachedToPanelRight) {
    throw new Error(`Layer panel is not attached to the shot edge: ${JSON.stringify(layerPanelPlacement)}`);
  }
  const openLayerToggleBottom = await evaluate(`
    document
      .querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]')
      ?.getBoundingClientRect().bottom
  `);
  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      return true;
    })()
  `);
  const layerToggleClickClosedPanel = await waitFor(
    () => evaluate(`!document.querySelector('.shot-layer-popover .layer-panel')`),
    "layer panel closes after toggle click"
  );
  const layerToggleBottomStableAfterClose = await waitFor(
    async () => {
      const state = await evaluate(`
        (() => {
          const panel = document.querySelector('.shot-layer-popover .layer-panel');
          const toggle = document
            .querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]');
          const stage = document.querySelector('[data-shot-id] .image-stage');
          const bottom = toggle?.getBoundingClientRect().bottom;
          return {
            ok: Boolean(!panel && toggle && Math.abs(bottom - ${openLayerToggleBottom}) <= 1),
            hasPanel: Boolean(panel),
            hasToggle: Boolean(toggle),
            openBottom: ${openLayerToggleBottom},
            closedBottom: bottom,
            stageBottom: stage?.getBoundingClientRect().bottom
          };
        })()
      `);
      if (!state.ok) {
        throw new Error(JSON.stringify(state));
      }
      return true;
    },
    "layer toggle bottom stable after close animation"
  );

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.shot-layer-popover .layer-panel'))`),
    "layer panel reopened after close animation"
  );
  await waitFor(
    () =>
      evaluate(`
        (() => {
          const popover = document.querySelector('.shot-layer-popover');
          return Boolean(popover && popover.getAnimations().every((animation) => animation.playState !== "running"));
        })()
      `),
    "layer panel reopen animation settled"
  );

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Add layer"]').click();
      return true;
    })()
  `);

  const paintLayer = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.[0]?.layers?.find((layer) => layer.kind === "paint");
  }, "paint layer metadata");
  const paintLayerPath = resolveLayerPath(smokeRoot, paintLayer.bitmapPath);
  const paintBlankHash = await layerAssetState(paintLayerPath);

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      document.querySelector('button[aria-label="Brush"]').click();
      return true;
    })()
  `);
  await dragStroke(send, startX, startY, endX, endY);

  const paintDrawnHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash !== paintBlankHash ? nextHash : undefined;
  }, "paint layer hash change after drawing");

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      return true;
    })()
  `);

  const paintThumbnailLoaded = await waitFor(
    () =>
      evaluate(`
        (() => {
          const row = document.querySelector('[data-layer-id="${paintLayer.id}"]');
          const image = row?.querySelector('.layer-thumb img');
          return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        })()
      `),
    "paint layer thumbnail image"
  );

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      document.querySelector('button[aria-label="Eraser"]').click();
      return true;
    })()
  `);
  await dragStroke(send, endX, endY, startX, startY);

  const paintErasedHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after eraser");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoEraseHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash === paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash restore after undo eraser");

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Select"]').click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector('button[aria-label="Select"]')?.classList.contains("selected")`),
    "select tool active"
  );

  const lassoStartX = Math.round(rect.x + rect.width * 0.30);
  const lassoStartY = Math.round(rect.y + rect.height * 0.40);
  const lassoEndX = Math.round(rect.x + rect.width * 0.70);
  const lassoEndY = Math.round(rect.y + rect.height * 0.68);
  await dragPolyline(send, [
    { x: lassoStartX, y: lassoStartY },
    { x: lassoEndX, y: lassoStartY },
    { x: lassoEndX, y: lassoEndY },
    { x: lassoStartX, y: lassoEndY },
    { x: lassoStartX, y: lassoStartY }
  ]);

  await waitFor(
    () => evaluate(`Boolean(document.querySelector(".bitmap-selection-outline"))`),
    "lasso selection outline"
  );

  const lassoMoveStartX = Math.round((lassoStartX + lassoEndX) / 2);
  const lassoMoveStartY = Math.round((lassoStartY + lassoEndY) / 2);
  await dragStroke(send, lassoMoveStartX, lassoMoveStartY, lassoMoveStartX + 24, lassoMoveStartY + 10);

  const paintLassoMovedHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after lasso move");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoLassoMoveHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash === paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash restore after undo lasso move");

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Brush"]').click();
      return true;
    })()
  `);
  const selectionClearedAfterToolSwitch = await waitFor(
    () =>
      evaluate(`
        !document.querySelector(".bitmap-selection-handle") &&
        !document.querySelector(".bitmap-selection-outline")
      `),
    "selection handles clear after switching tools"
  );

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Select"]').click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector('button[aria-label="Select"]')?.classList.contains("selected")`),
    "select tool active before rectangle"
  );

  await evaluate(`
    (() => {
      const button = document.querySelector('button[aria-label="Select"]');
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
      return true;
    })()
  `);
  await evaluate(`
    (() => {
      Array.from(document.querySelectorAll('.selection-mode-menu button'))
        .find((button) => button.textContent.trim() === 'Rectangle')
        .click();
      return true;
    })()
  `);

  await dragStroke(send, lassoStartX, lassoStartY, lassoEndX, lassoEndY);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector(".bitmap-selection-bounds"))`),
    "rectangle selection bounds"
  );
  await dragStroke(send, lassoEndX, lassoEndY, lassoEndX + 24, lassoEndY + 16);

  const paintRectangleScaledHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after rectangle scale");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoRectangleScaleHash = await waitFor(async () => {
    const nextHash = await layerAssetState(paintLayerPath);
    return nextHash === paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash restore after undo rectangle scale");

  await evaluate(`
    (() => {
      if (!document.querySelector('.shot-layer-popover .layer-panel')) {
        document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      }
      return true;
    })()
  `);
  await waitFor(
    () =>
      evaluate(`
        (() => {
          const popover = document.querySelector('.shot-layer-popover');
          return Boolean(popover && popover.getAnimations().every((animation) => animation.playState !== "running"));
        })()
      `),
    "layer panel open animation settled"
  );

  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${paintLayer.id}"] button[aria-label="Layer blend mode: normal"]').click();
      return true;
    })()
  `);

  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.layer-blend-menu'))`),
    "paint layer blend mode menu"
  );

  const multiplyBlendButton = await evaluate(`
    (() => {
      const button = Array.from(document.querySelectorAll('.layer-blend-menu button'))
        .find((button) => button.textContent.trim() === 'Multiply');
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: multiplyBlendButton.x,
    y: multiplyBlendButton.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: multiplyBlendButton.x,
    y: multiplyBlendButton.y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });

  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${paintLayer.id}"]').click();
      return true;
    })()
  `);

  await waitFor(
    () => evaluate(`document.querySelector('[data-layer-id="${paintLayer.id}"]')?.classList.contains('is-active')`),
    "paint layer active before opacity drag"
  );

  const paintBlendDotUpdated = await waitFor(
    () =>
      evaluate(`
        Boolean(document.querySelector('[data-layer-id="${paintLayer.id}"] button[aria-label="Layer blend mode: multiply"]'))
      `),
    "paint layer blend mode dot update"
  );
  const paintBlendModeAppliedToStage = await waitFor(
    () =>
      evaluate(`
        (() => {
          const layerIndex = Array.from(document.querySelectorAll(".image-stage img"))
            .findIndex((image) => getComputedStyle(image).mixBlendMode === "multiply");
          return layerIndex >= 0 && getComputedStyle(document.querySelector(".image-stage")).isolation === "isolate";
        })()
      `),
    "paint layer blend mode applied to stage"
  );

  const paintOrderBeforeOpacityDrag = (await readProjectMetadata(smokeRoot)).shots[0].layers.map((layer) => layer.id);
  const paintOpacityDrag = await evaluate(`
    (() => {
      const row = document.querySelector('[data-layer-id="${paintLayer.id}"]');
      const rect = row.getBoundingClientRect();
      return {
        startX: rect.left + rect.width * 0.25,
        startY: rect.top + rect.height / 2,
        endX: rect.left + rect.width * 0.35,
        endY: rect.top + rect.height / 2
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: paintOpacityDrag.startX,
    y: paintOpacityDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: paintOpacityDrag.endX,
    y: paintOpacityDrag.endY,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: paintOpacityDrag.endX,
    y: paintOpacityDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });

  const paintMetadata = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layer = project.shots?.[0]?.layers?.find((item) => item.id === paintLayer.id);
    return layer?.opacity === 0.35 && layer?.blendMode === "multiply" ? layer : undefined;
  }, "paint layer row opacity drag metadata");
  const paintOrderAfterOpacityDrag = (await readProjectMetadata(smokeRoot)).shots[0].layers.map((layer) => layer.id);
  if (JSON.stringify(paintOrderAfterOpacityDrag) !== JSON.stringify(paintOrderBeforeOpacityDrag)) {
    throw new Error("Horizontal opacity drag changed layer order");
  }
  const paintOpacityFillUpdated = await waitFor(
    () =>
      evaluate(`
        document
          .querySelector('[data-layer-id="${paintLayer.id}"]')
          ?.style.getPropertyValue("--layer-opacity-width") === "35%"
      `),
    "paint layer opacity fill update"
  );
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${paintLayer.id}"] button[aria-label="Lock layer"]').click();
      return true;
    })()
  `);
  await waitFor(
    async () => {
      const project = await readProjectMetadata(smokeRoot);
      return project.shots?.[0]?.layers?.find((item) => item.id === paintLayer.id)?.locked === true;
    },
    "paint layer locked metadata"
  );
  const lockedOpacityDrag = await evaluate(`
    (() => {
      const row = document.querySelector('[data-layer-id="${paintLayer.id}"]');
      const rect = row.getBoundingClientRect();
      return {
        startX: rect.left + rect.width * 0.35,
        startY: rect.top + rect.height / 2,
        endX: rect.left + rect.width * 0.75,
        endY: rect.top + rect.height / 2
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: lockedOpacityDrag.startX,
    y: lockedOpacityDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: lockedOpacityDrag.endX,
    y: lockedOpacityDrag.endY,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: lockedOpacityDrag.endX,
    y: lockedOpacityDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
  const layerLockChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layer = project.shots?.[0]?.layers?.find((item) => item.id === paintLayer.id);
    const blendDisabled = await evaluate(`
      document.querySelector('[data-layer-id="${paintLayer.id}"] button[aria-label="Layer blend mode: multiply"]')?.disabled === true
    `);
    const deleteDisabled = await evaluate(`
      document.querySelector('button[aria-label="Delete current layer"]')?.disabled === true
    `);
    return layer?.locked === true && layer.opacity === 0.35 && layer.blendMode === "multiply" && blendDisabled && deleteDisabled
      ? { opacityBlocked: true, blendDisabled, deleteDisabled }
      : undefined;
  }, "locked paint layer blocks edits");
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${paintLayer.id}"] button[aria-label="Unlock layer"]').click();
      return true;
    })()
  `);
  await waitFor(
    async () => {
      const project = await readProjectMetadata(smokeRoot);
      return project.shots?.[0]?.layers?.find((item) => item.id === paintLayer.id)?.locked === false;
    },
    "paint layer unlocked metadata"
  );
  const layerRowHeightBeforeAdd = await evaluate(`
    document.querySelector('[data-layer-id="${paintLayer.id}"]')?.getBoundingClientRect().height
  `);

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Add layer"]').click();
      return true;
    })()
  `);

  const secondPaintLayer = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.[0]?.layers?.find(
      (layer) => layer.kind === "paint" && layer.id !== paintLayer.id
    );
  }, "second paint layer metadata");
  const secondPaintLayerPath = resolveLayerPath(smokeRoot, secondPaintLayer.bitmapPath);
  const secondPaintLayerAssetState = await layerAssetState(secondPaintLayerPath);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await waitForUndoReady();
  await dispatchKeyZ(send, 4);
	  const addLayerUndoChecks = await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id) ?? [];
	    const assetState = await layerAssetState(secondPaintLayerPath);
	    return !layerIds.includes(secondPaintLayer.id) && assetState === "missing"
	      ? { metadataRemoved: true, assetRemoved: true }
	      : undefined;
	  }, "added paint layer undo removes metadata");
  await dispatchKeyZ(send, 12);
  const addLayerRedoChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layer = project.shots?.[0]?.layers?.find((item) => item.id === secondPaintLayer.id);
    const assetState = await layerAssetState(secondPaintLayerPath);
    return layer && assetState === secondPaintLayerAssetState
      ? { metadataRestored: true, assetUnchanged: true }
      : undefined;
  }, "added paint layer redo restores metadata");
  await sharp({
    create: {
      width: secondPaintLayer.width,
      height: secondPaintLayer.height,
      channels: 4,
      background: { r: 0, g: 210, b: 80, alpha: 1 }
    }
  })
    .png()
    .toFile(secondPaintLayerPath);
  const mergeSourceHashBefore = await layerAssetState(secondPaintLayerPath);
  const mergeTargetHashBefore = await layerAssetState(paintLayerPath);
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${secondPaintLayer.id}"]').click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector('[data-layer-id="${secondPaintLayer.id}"]')?.classList.contains('is-active')`),
    "second paint layer active before merge down"
  );
  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Merge"]').click();
      return true;
    })()
  `);
  const mergeDownChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layers = project.shots?.[0]?.layers ?? [];
    const target = layers.find((layer) => layer.id === paintLayer.id);
    const source = layers.find((layer) => layer.id === secondPaintLayer.id);
    const targetHash = await layerAssetState(paintLayerPath);
    const sourceHash = await layerAssetState(secondPaintLayerPath);

    return !source &&
      project.shots?.[0]?.activeLayerId === paintLayer.id &&
      target?.opacity === 1 &&
      target?.blendMode === "normal" &&
      targetHash !== mergeTargetHashBefore &&
      sourceHash === "missing"
      ? { metadataMerged: true, targetReset: true, sourceAssetDeleted: true }
      : undefined;
  }, "merge down metadata and assets");
  await waitForUndoReady();
  await dispatchKeyZ(send, 4);
  const mergeUndoChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const target = project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id);
    const source = project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id);
    const targetHash = await layerAssetState(paintLayerPath);
    const sourceHash = await layerAssetState(secondPaintLayerPath);

    return source &&
      target?.opacity === 0.35 &&
      target?.blendMode === "multiply" &&
      targetHash === mergeTargetHashBefore &&
      sourceHash === mergeSourceHashBefore
      ? { metadataRestored: true, assetsRestored: true }
      : undefined;
  }, "merge down undo restores metadata and assets");
  await dispatchKeyZ(send, 12);
  const mergeRedoChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const source = project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id);
    const target = project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id);
    const sourceHash = await layerAssetState(secondPaintLayerPath);

    return !source && target?.opacity === 1 && target?.blendMode === "normal" && sourceHash === "missing"
      ? { metadataMergedAgain: true, sourceAssetDeletedAgain: true }
      : undefined;
  }, "merge down redo reapplies merge");
  await dispatchKeyZ(send, 4);
	  await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const target = project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id);
	    const targetHash = await layerAssetState(paintLayerPath);
	    const sourceHash = await layerAssetState(secondPaintLayerPath);
    return project.shots?.[0]?.layers?.some((layer) => layer.id === secondPaintLayer.id) &&
      target?.opacity === 0.35 &&
      target?.blendMode === "multiply" &&
      targetHash === mergeTargetHashBefore &&
      sourceHash === mergeSourceHashBefore
      ? true
	      : undefined;
	  }, "merge down final undo restores source for remaining smoke");
	  await evaluate(`
	    (() => {
	      document.querySelector('[data-layer-id="${secondPaintLayer.id}"] button[aria-label="Lock layer"]').click();
	      return true;
	    })()
	  `);
	  await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    return project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id)?.locked === true;
	  }, "second paint layer locked before merge visible");
	  const mergeVisibleButtonEnabledWithLockedLayer = await evaluate(`
	    document.querySelector('button[aria-label="Merge visible layers"]')?.disabled === false
	  `);
	  if (!mergeVisibleButtonEnabledWithLockedLayer) {
	    throw new Error("Merge visible should stay enabled when a visible layer is locked");
	  }
	  const mergeVisibleProjectBefore = await readProjectMetadata(smokeRoot);
	  const mergeVisibleLayersBefore = mergeVisibleProjectBefore.shots[0].layers.filter((layer) => layer.visible);
	  const mergeVisibleLayerIdsBefore = new Set(mergeVisibleLayersBefore.map((layer) => layer.id));
	  const mergeVisibleLockedSources = mergeVisibleLayersBefore.filter((layer) => layer.locked);
	  const mergeVisibleUnlockedSources = mergeVisibleLayersBefore.filter((layer) => !layer.locked);
	  const mergeVisibleSourceStatesBefore = Object.fromEntries(
	    await Promise.all(
	      mergeVisibleLayersBefore.map(async (layer) => [
	        layer.id,
	        await layerAssetState(resolveLayerPath(smokeRoot, layer.bitmapPath))
	      ])
	    )
	  );
	  await evaluate(`
	    (() => {
	      document.querySelector('button[aria-label="Merge visible layers"]').click();
	      return true;
	    })()
	  `);
	  const mergeVisibleChecks = await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const layers = project.shots?.[0]?.layers ?? [];
	    const merged = layers.find((layer) => !mergeVisibleLayerIdsBefore.has(layer.id));
	    const unlockedSourcesRemoved = mergeVisibleUnlockedSources.every(
	      (sourceLayer) => !layers.some((layer) => layer.id === sourceLayer.id)
	    );
	    const lockedSourcesHidden = mergeVisibleLockedSources.every((sourceLayer) => {
	      const layer = layers.find((item) => item.id === sourceLayer.id);
	      return layer?.visible === false && layer.locked === true;
	    });
	    const mergedHash = merged ? await layerAssetState(resolveLayerPath(smokeRoot, merged.bitmapPath)) : "missing";
	    const unlockedSourceAssetsDeleted = (await Promise.all(
	      mergeVisibleUnlockedSources.map(async (sourceLayer) =>
	        layerAssetState(resolveLayerPath(smokeRoot, sourceLayer.bitmapPath))
	      )
	    )).every((assetState) => assetState === "missing");
	    const lockedSourceAssetsPreserved = (await Promise.all(
	      mergeVisibleLockedSources.map(async (sourceLayer) => [
	        sourceLayer.id,
	        await layerAssetState(resolveLayerPath(smokeRoot, sourceLayer.bitmapPath))
	      ])
	    )).every(([sourceLayerId, assetState]) => assetState === mergeVisibleSourceStatesBefore[sourceLayerId]);

	    return merged &&
	      unlockedSourcesRemoved &&
	      lockedSourcesHidden &&
	      merged.name === "Merged" &&
	      merged.opacity === 1 &&
	      merged.blendMode === "normal" &&
	      project.shots?.[0]?.activeLayerId === merged.id &&
	      mergedHash !== "missing" &&
	      unlockedSourceAssetsDeleted &&
	      lockedSourceAssetsPreserved
	      ? { metadataMerged: true, lockedSourceHidden: true, unlockedSourceAssetDeleted: true, lockedSourceAssetPreserved: true }
	      : undefined;
	  }, "merge visible metadata and assets");
	  await waitForUndoReady();
	  await dispatchKeyZ(send, 4);
	  const mergeVisibleUndoChecks = await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const layers = project.shots?.[0]?.layers ?? [];
	    const restoredSources = mergeVisibleLayersBefore.every((sourceLayer) => {
	      const layer = layers.find((item) => item.id === sourceLayer.id);
	      return layer?.visible === sourceLayer.visible && layer.locked === sourceLayer.locked;
	    });
	    const mergedLayersRemoved = layers.every((layer) =>
	      mergeVisibleProjectBefore.shots[0].layers.some((beforeLayer) => beforeLayer.id === layer.id)
	    );
	    const sourceAssetsRestored = (await Promise.all(
	      mergeVisibleLayersBefore.map(async (sourceLayer) => [
	        sourceLayer.id,
	        await layerAssetState(resolveLayerPath(smokeRoot, sourceLayer.bitmapPath))
	      ])
	    )).every(([sourceLayerId, assetState]) => assetState === mergeVisibleSourceStatesBefore[sourceLayerId]);

	    return restoredSources &&
	      mergedLayersRemoved &&
	      sourceAssetsRestored
	      ? { metadataRestored: true, assetsRestored: true }
	      : undefined;
	  }, "merge visible undo restores metadata and assets");
	  await evaluate(`
	    (() => {
	      document.querySelector('[data-layer-id="${secondPaintLayer.id}"] button[aria-label="Unlock layer"]').click();
	      return true;
	    })()
	  `);
	  await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    return project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id)?.locked === false;
	  }, "second paint layer unlocked after merge visible");
  // Undo has just restored this referenced source. Do not remove it as old
  // blank-layer fixture cleanup: subsequent gestures require intact assets.
  // Missing referenced files are intentionally rejected by normal admission.
  if (await layerAssetState(secondPaintLayerPath) !== mergeVisibleSourceStatesBefore[secondPaintLayer.id]) {
    throw new Error("Merge Undo did not retain the second paint source for following gestures");
  }
  // Reset the synthetic green Merge input through the real Clear action. The
  // old unlink accidentally depended on ensure repairing a referenced file;
  // keeping its green pixels would invalidate the later white-background check.
  await evaluate(`(() => {
    document.querySelector('[data-layer-id="${secondPaintLayer.id}"]').click();
    return true;
  })()`);
  await waitFor(() => evaluate(`document.querySelector('[data-layer-id="${secondPaintLayer.id}"]')?.classList.contains('is-active')`),
    "synthetic Merge source active before reset");
  await evaluate(`document.querySelector('button[aria-label="Clear current layer"]').click()`);
  await waitFor(async () => {
    const pixels = await sharp(secondPaintLayerPath).ensureAlpha().raw().toBuffer();
    return pixels.every((value, index) => index % 4 !== 3 || value === 0);
  }, "synthetic Merge source reset by real Clear before remaining gestures");
  // The existing Photoshop importer intentionally skips fully empty layers.
  // Give this retained layer real non-corner pixels via normal drawing, so the
  // later Save/import round-trip genuinely verifies two independent layers.
  await evaluate(`document.querySelector('button[aria-label="Brush"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('button[aria-label="Brush"]')?.classList.contains("selected")`),
    "brush active for retained second-layer round-trip marker");
  const markerRect = await evaluate(`(() => { const r = document.querySelector('[data-shot-id] .image-stage').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  await dragStroke(send, markerRect.x + markerRect.width * 0.45, markerRect.y + markerRect.height * 0.55,
    markerRect.x + markerRect.width * 0.55, markerRect.y + markerRect.height * 0.55);
  await waitFor(async () => {
    const pixels = await sharp(secondPaintLayerPath).ensureAlpha().raw().toBuffer();
    return pixels[3] === 0 && pixels.some((value, index) => index % 4 === 3 && value > 0);
  }, "second layer marker durable with transparent top-left");
  const layerRowsKeepFixedHeight = await waitFor(
    () =>
      evaluate(`
        (() => {
          const row = document.querySelector('[data-layer-id="${paintLayer.id}"]');
          return row && Math.abs(row.getBoundingClientRect().height - ${layerRowHeightBeforeAdd}) < 0.5;
        })()
      `),
    "layer rows keep fixed height after adding layer"
  );
  const layerListWheelPreservedZoom = await evaluate(`
    (() => {
      const zoom = document.querySelector('.bottom-bar input[type="range"]');
      const list = document.querySelector(".layer-list");
      const before = zoom.value;
      list.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120
      }));
      return zoom.value === before;
    })()
  `);
  if (!layerListWheelPreservedZoom) {
    throw new Error("Layer list wheel event changed storyboard zoom");
  }

	  const layerVisibilityHideDrag = await evaluate(`
	    (() => {
      const first = document
        .querySelector('[data-layer-id="${secondPaintLayer.id}"] .layer-select')
        .getBoundingClientRect();
      const second = document
        .querySelector('[data-layer-id="${paintLayer.id}"] .layer-select')
        .getBoundingClientRect();
      return {
        startX: first.left + first.width / 2,
        startY: first.top + first.height / 2,
        endX: second.left + second.width / 2,
        endY: second.top + second.height / 2
	      };
	    })()
	  `);
	  const layerVisibilityHitTest = await evaluate(`
	    (() => {
	      const point = (x, y) => {
	        const element = document.elementFromPoint(x, y);
	        return element
	          ? { tag: element.tagName, className: String(element.className), label: element.getAttribute("aria-label"), closestLayerSelect: Boolean(element.closest(".layer-select")) }
	          : null;
	      };
	      return {
	        start: point(${layerVisibilityHideDrag.startX}, ${layerVisibilityHideDrag.startY}),
	        end: point(${layerVisibilityHideDrag.endX}, ${layerVisibilityHideDrag.endY})
	      };
	    })()
	  `);
	  if (!layerVisibilityHitTest.start?.closestLayerSelect || !layerVisibilityHitTest.end?.closestLayerSelect) {
	    throw new Error(`Layer visibility drag hit-test missed buttons: ${JSON.stringify(layerVisibilityHitTest)}`);
	  }
	  await dragStroke(
	    send,
	    layerVisibilityHideDrag.startX,
	    layerVisibilityHideDrag.startY,
	    layerVisibilityHideDrag.endX,
	    layerVisibilityHideDrag.endY
	  );
  const hiddenByVisibilityDrag = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const hiddenPaintLayer = project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id);
    const hiddenSecondLayer = project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id);
    if (hiddenPaintLayer?.visible === false && hiddenSecondLayer?.visible === false) {
      return true;
    }
    throw new Error(
      JSON.stringify({
        paintLayerVisible: hiddenPaintLayer?.visible,
        secondPaintLayerVisible: hiddenSecondLayer?.visible
      })
    );
  }, "layer visibility drag hides crossed layer buttons");

  const layerVisibilityShowDrag = await evaluate(`
    (() => {
      const first = document
        .querySelector('[data-layer-id="${paintLayer.id}"] .layer-select')
        .getBoundingClientRect();
      const second = document
        .querySelector('[data-layer-id="${secondPaintLayer.id}"] .layer-select')
        .getBoundingClientRect();
      return {
        startX: first.left + first.width / 2,
        startY: first.top + first.height / 2,
        endX: second.left + second.width / 2,
        endY: second.top + second.height / 2
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: layerVisibilityShowDrag.startX,
    y: layerVisibilityShowDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: layerVisibilityShowDrag.endX,
    y: layerVisibilityShowDrag.endY,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: layerVisibilityShowDrag.endX,
    y: layerVisibilityShowDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
  const shownByVisibilityDrag = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const shownPaintLayer = project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id);
    const shownSecondLayer = project.shots?.[0]?.layers?.find((layer) => layer.id === secondPaintLayer.id);
    return shownPaintLayer?.visible === true && shownSecondLayer?.visible === true ? true : undefined;
  }, "layer visibility drag shows crossed layer buttons");
  const layerVisibilityDragChecks = {
    hiddenByVisibilityDrag,
    shownByVisibilityDrag
  };

  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="layer-image"] button[aria-label="Lock layer"]').click();
      return true;
    })()
  `);
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.[0]?.layers?.find((layer) => layer.id === "layer-image")?.locked === true;
  }, "image layer locked before layer multiselect");
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${secondPaintLayer.id}"]').click();
      document.querySelector('[data-layer-id="layer-image"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
      return true;
    })()
  `);
  const layerMultiSelectChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const selectedCount = await evaluate(`document.querySelectorAll(".layer-row.is-selected").length`);
    const activeName = await evaluate(`
      document.querySelector(".layer-row.is-active input[aria-label='Layer name']")?.value
    `);
    const selectedRowsHaveRedBars = await evaluate(`
      Array.from(document.querySelectorAll(".layer-row.is-selected"))
        .every((row) => getComputedStyle(row).boxShadow.includes("inset"))
    `);
    const imageLocked = project.shots?.[0]?.layers?.find((layer) => layer.id === "layer-image")?.locked;
    if (selectedCount === 3 && activeName === "Image" && imageLocked && selectedRowsHaveRedBars) {
      return { selectedCount, activeName, lockedSelectedLayer: true, selectedRowsHaveRedBars };
    }
    const layerUiState = await evaluate(`
      Array.from(document.querySelectorAll(".layer-row")).map((row) => ({
        id: row.dataset.layerId,
        className: row.className,
        name: row.querySelector("input[aria-label='Layer name']")?.value,
        boxShadow: getComputedStyle(row).boxShadow
      }))
    `);
    throw new Error(JSON.stringify({ selectedCount, activeName, imageLocked, selectedRowsHaveRedBars, layerUiState }));
  }, "shift-click layer multiselect");
  const multiOpacityDrag = await evaluate(`
    (() => {
      const row = document.querySelector('[data-layer-id="${secondPaintLayer.id}"]');
      const rect = row.getBoundingClientRect();
      return {
        startX: rect.left + rect.width * 0.45,
        startY: rect.top + rect.height / 2,
        endX: rect.left + rect.width * 0.55,
        endY: rect.top + rect.height / 2
      };
    })()
  `);
  await dragStroke(send, multiOpacityDrag.startX, multiOpacityDrag.startY, multiOpacityDrag.endX, multiOpacityDrag.endY);
  const layerMultiOpacityChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layers = project.shots?.[0]?.layers ?? [];
    const image = layers.find((layer) => layer.id === "layer-image");
    const first = layers.find((layer) => layer.id === paintLayer.id);
    const second = layers.find((layer) => layer.id === secondPaintLayer.id);
    return image?.opacity === 1 &&
      (first?.opacity ?? 0) > 0.42 &&
      (first?.opacity ?? 0) < 0.48 &&
      second?.opacity === 1
      ? { imageOpacityUnchanged: true, firstOpacity: first.opacity, secondOpacity: second.opacity }
      : undefined;
  }, "layer multiselect opacity drag");
  const multiLayerOrderBeforeDrag = (await readProjectMetadata(smokeRoot)).shots[0].layers.map((layer) => layer.id);
  const multiLayerGroupDrag = await evaluate(`
    (() => {
      const sourceRow = document.querySelector('[data-layer-id="${secondPaintLayer.id}"]');
      const targetRow = document.querySelector('[data-layer-id="layer-image"]');
      const source = sourceRow.getBoundingClientRect();
      const target = targetRow.getBoundingClientRect();
      return {
        startX: source.left + source.width * 0.62,
        startY: source.top + source.height / 2,
        endX: target.left + target.width * 0.62,
        endY: target.bottom - 2
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: multiLayerGroupDrag.startX,
    y: multiLayerGroupDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: multiLayerGroupDrag.endX,
    y: multiLayerGroupDrag.endY,
    button: "left",
    buttons: 1
  });
  const layerMultiDragPreviewVisible = await waitFor(
    () =>
      evaluate(`
        (() => {
          const first = document.querySelector('[data-layer-id="${paintLayer.id}"]');
          const second = document.querySelector('[data-layer-id="${secondPaintLayer.id}"]');
          const locked = document.querySelector('[data-layer-id="layer-image"]');
          return Boolean(
            first?.classList.contains("is-reorder-dragging") &&
            second?.classList.contains("is-reorder-dragging") &&
            !locked?.classList.contains("is-reorder-dragging")
          );
        })()
      `),
    "layer multiselect drag visual preview"
  );
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: multiLayerGroupDrag.endX,
    y: multiLayerGroupDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
  const layerMultiReorderChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id);
    return layerIds?.[0] === paintLayer.id &&
      layerIds?.[1] === secondPaintLayer.id &&
      layerIds?.[2] === "layer-image"
      ? { before: multiLayerOrderBeforeDrag, after: layerIds }
      : undefined;
  }, "layer multiselect reorder metadata").catch(async (error) => {
    const project = await readProjectMetadata(smokeRoot);
    throw new Error(`${error.message}: ${JSON.stringify(project.shots?.[0]?.layers?.map((layer) => layer.id))}`);
  });
  await delay(50);
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="${paintLayer.id}"]').click();
      return true;
    })()
  `);
  const layerSingleClickClearsMultiSelect = await waitFor(
    () =>
      evaluate(`
        document.querySelectorAll(".layer-row.is-selected").length === 1 &&
          document.querySelector('[data-layer-id="${paintLayer.id}"]')?.classList.contains("is-selected")
      `),
    "ordinary layer click clears layer multiselect"
  );
  await evaluate(`
    (() => {
      document.querySelector('[data-layer-id="layer-image"] button[aria-label="Unlock layer"]').click();
      return true;
    })()
  `);
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.[0]?.layers?.find((layer) => layer.id === "layer-image")?.locked === false;
  }, "image layer unlocked after layer multiselect smoke");
  const resetPaintOpacityDrag = await evaluate(`
    (() => {
      const row = document.querySelector('[data-layer-id="${paintLayer.id}"]');
      const rect = row.getBoundingClientRect();
      return {
        startX: rect.left + rect.width * 0.45,
        startY: rect.top + rect.height / 2,
        endX: rect.left + rect.width * 0.35,
        endY: rect.top + rect.height / 2
      };
    })()
  `);
  await dragStroke(
    send,
    resetPaintOpacityDrag.startX,
    resetPaintOpacityDrag.startY,
    resetPaintOpacityDrag.endX,
    resetPaintOpacityDrag.endY
  );
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    return project.shots?.[0]?.layers?.find((layer) => layer.id === paintLayer.id)?.opacity === 0.35;
  }, "paint layer opacity reset after layer multiselect smoke");
  const resetImageLayerOrderDrag = await evaluate(`
    (() => {
      const sourceRow = document.querySelector('[data-layer-id="layer-image"]');
      const layerList = document.querySelector(".layer-list");
      const source = sourceRow.getBoundingClientRect();
      const list = layerList.getBoundingClientRect();
      return {
        startX: source.left + source.width * 0.62,
        startY: source.top + source.height / 2,
        endX: source.left + source.width * 0.62,
        endY: list.bottom - 4
      };
    })()
  `);
  await dragStroke(
    send,
    resetImageLayerOrderDrag.startX,
    resetImageLayerOrderDrag.startY,
    resetImageLayerOrderDrag.endX,
    resetImageLayerOrderDrag.endY
  );
  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id);
    return JSON.stringify(layerIds) === JSON.stringify(multiLayerOrderBeforeDrag) ? project : undefined;
  }, "layer order reset after layer multiselect smoke");

  const paintOrderBeforeDrag = (await readProjectMetadata(smokeRoot)).shots[0].layers.map((layer) => layer.id);

  const paintLayerDrag = await evaluate(`
    (() => {
      const paintRows = Array.from(document.querySelectorAll(".layer-row")).filter(
        (row) => row.querySelector('input[aria-label="Layer name"]')?.value !== "Image"
      );
      const secondPaintRow = paintRows[0];
      const firstPaintRow = paintRows[1];
      const source = secondPaintRow.getBoundingClientRect();
      const target = firstPaintRow.getBoundingClientRect();
      return {
        startX: source.left + source.width * 0.62,
        startY: source.top + source.height / 2,
        endX: target.left + target.width * 0.62,
        endY: target.bottom - 2
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: paintLayerDrag.startX,
    y: paintLayerDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: paintLayerDrag.endX,
    y: paintLayerDrag.endY,
    button: "left",
    buttons: 1
  });
  const paintLayerDragPreviewVisible = await waitFor(
    () =>
      evaluate(`
        (() => {
          const row = document.querySelector('[data-layer-id="${secondPaintLayer.id}"]');
          return Boolean(
            row?.classList.contains("is-reorder-dragging") &&
            row?.classList.contains("is-dragging-layer") &&
            row.style.transform.startsWith("translateY(")
          );
        })()
      `),
    "paint layer drag visual preview"
  );
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: paintLayerDrag.endX,
    y: paintLayerDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });

  const paintOrderAfterDrag = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id);
    if (layerIds?.[1] === secondPaintLayer.id && layerIds?.[2] === paintLayer.id) {
      return layerIds;
    }

    throw new Error(`current order: ${JSON.stringify(layerIds)}`);
  }, "paint layer drag sort metadata");
  const paintLayerAfterVerticalDrag = (await readProjectMetadata(smokeRoot)).shots[0].layers.find((layer) => layer.id === secondPaintLayer.id);
  if (paintLayerAfterVerticalDrag?.opacity !== 1) {
    throw new Error("Vertical layer reorder drag changed opacity");
  }

  const dragTopLayerToBottomBlank = await evaluate(`
    (() => {
      const sourceRow = document.querySelector('[data-layer-id="${paintLayer.id}"]');
      const layerList = document.querySelector(".layer-list");
      const source = sourceRow.getBoundingClientRect();
      const list = layerList.getBoundingClientRect();
      return {
        startX: source.left + source.width * 0.62,
        startY: source.top + source.height / 2,
        endX: source.left + source.width * 0.62,
        endY: list.bottom - 4
      };
    })()
  `);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: dragTopLayerToBottomBlank.startX,
    y: dragTopLayerToBottomBlank.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: dragTopLayerToBottomBlank.endX,
    y: dragTopLayerToBottomBlank.endY,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: dragTopLayerToBottomBlank.endX,
    y: dragTopLayerToBottomBlank.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });

  const paintOrderAfterBottomBlankDrag = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id);
    if (layerIds?.[0] === paintLayer.id && layerIds?.[1] === "layer-image" && layerIds?.[2] === secondPaintLayer.id) {
      return layerIds;
    }

    throw new Error(`current order: ${JSON.stringify(layerIds)}`);
  }, "paint layer drag to bottom blank area metadata");
  if (
    (await layerAssetState(secondShotLayerPath)) !== secondShotBeforeHash ||
    (await layerAssetState(thirdShotLayerPath)) !== thirdShotBeforeHash
  ) {
    throw new Error("Drawing on the selected shot changed a neighboring shot layer");
  }

  await evaluate(`
    (() => {
      const panelToggle = document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]');
      if (!document.querySelector(".layer-panel")) {
        panelToggle?.click();
      }
      document.querySelector('.layer-row[data-layer-id="${paintLayer.id}"]')?.click();
      document.body.tabIndex = -1;
      document.body.focus();
      return true;
    })()
  `);
  const layerPasteBefore = await readProjectMetadata(smokeRoot);
  await dispatchModifiedKey(send, "c", "KeyC", 67, 4);
  await dispatchModifiedKey(send, "v", "KeyV", 86, 4);
  const layerPasteChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layers = project.shots?.[0]?.layers ?? [];
    const pastedLayer = layers.find((layer) => !layerPasteBefore.shots[0].layers.some((beforeLayer) => beforeLayer.id === layer.id));
    const pastedLayerPath = pastedLayer ? resolveLayerPath(smokeRoot, pastedLayer.bitmapPath) : undefined;
    const pastedLayerAssetState = pastedLayerPath ? await layerAssetState(pastedLayerPath) : "missing";
    return pastedLayer &&
      layers.length === layerPasteBefore.shots[0].layers.length + 1 &&
      project.shots?.[0]?.activeLayerId === pastedLayer.id &&
      pastedLayer.name === paintLayer.name &&
      pastedLayerAssetState !== "missing"
      ? { pastedLayerId: pastedLayer.id, pastedLayerPath, pastedLayerAssetState }
      : undefined;
  }, "layer keyboard copy paste");
  await evaluate(`
    (() => {
      document.querySelector('.layer-row[data-layer-id="${layerPasteChecks.pastedLayerId}"]')?.click();
      document.body.tabIndex = -1;
      document.body.focus();
      return true;
    })()
  `);
  await dispatchKey(send, "Delete", "Delete", 46);
  const layerPasteCleanupChecks = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layers = project.shots?.[0]?.layers ?? [];
    const pastedLayerAssetState = await layerAssetState(layerPasteChecks.pastedLayerPath);
    if (
      layers.length === layerPasteBefore.shots[0].layers.length &&
      !layers.some((layer) => layer.id === layerPasteChecks.pastedLayerId) &&
      pastedLayerAssetState === "missing"
    ) {
      return { pastedLayerRemoved: true, assetRemoved: true };
    }
    throw new Error(JSON.stringify({
      expectedLayerCount: layerPasteBefore.shots[0].layers.length,
      actualLayerCount: layers.length,
      pastedLayerStillPresent: layers.some((layer) => layer.id === layerPasteChecks.pastedLayerId),
      pastedLayerAssetState
    }));
  }, "layer keyboard paste cleanup removes copied layer");

  // Scenario: Photoshop layered TIFF export/import round trip.
  await exportPhotoshopTiffsViaDebugApi(smokeRoot);
  const photoshopExportFiles = await waitFor(async () => {
    const files = await findPhotoshopExportFiles(smokeRoot);
    return files.length === 3 ? files : undefined;
  }, "Photoshop layered TIFF export files", 20000);
  const photoshopLayerNames = await readPhotoshopLayerNames(photoshopExportFiles[0]);
  if (
    photoshopLayerNames.length < 3 ||
    !photoshopLayerNames.includes("Image")
  ) {
    throw new Error(`Photoshop TIFF readback did not preserve layers: ${JSON.stringify(photoshopLayerNames)}`);
  }

  await mkdir(photoshopImportRoot, { recursive: true });
  const photoshopImportSourcePath = path.join(photoshopImportRoot, "import-me.tiff");
  await copyFile(photoshopExportFiles[0], photoshopImportSourcePath);
  const photoshopImportSourceHash = await hashFile(photoshopImportSourcePath);

  await openFolder(photoshopImportRoot, { waitForMetadata: false });
  if (await hashFile(photoshopImportSourcePath) !== photoshopImportSourceHash) throw new Error("Opening Photoshop input changed original bytes before Import");
  await waitFor(
    () =>
      evaluate(`
        (() => {
          const importButton = Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent.trim() === "Import");
          return Boolean(importButton && !importButton.disabled);
        })()
      `),
    "Photoshop TIFF import button enabled"
  );
  await evaluate(`
    (() => {
      const importButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Import");
      importButton.click();
      return true;
    })()
  `);
  const importProgressShown = await waitFor(
    () =>
      evaluate(`
        document.querySelector(".workspace-task-progress")?.textContent.includes("Importing workspace changes")
      `),
    "Import progress indicator"
  );
  const photoshopImportedProject = await waitFor(async () => {
    const project = await readProjectMetadata(photoshopImportRoot);
    const shot = project.shots?.[0];
    return shot?.swb?.sourceKind === "photoshop-layered-tiff" ? project : undefined;
  }, "Photoshop layered TIFF round-trip import", 20000);
  await waitFor(
    () =>
      evaluate(`
        (() => ({
          warningVisible: Boolean(document.querySelector(".import-warning")),
          importDisabled: Boolean(Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent.trim() === "Import")?.disabled),
          statusText: document.querySelector(".status-popover")?.textContent ?? ""
        }))()
      `).then((state) => {
        if (!state.warningVisible && state.importDisabled) {
          return true;
        }
        throw new Error(JSON.stringify(state));
      }),
    "import warning hidden after Photoshop TIFF import"
  );
  const photoshopImportedShot = photoshopImportedProject.shots?.[0];
  const photoshopImportedLayers = photoshopImportedShot?.layers ?? [];
  const photoshopImportedLayerNames = photoshopImportedShot?.layers?.map((layer) => layer.name) ?? [];
  const photoshopImportedTopLayerId = [...photoshopImportedLayers].sort((a, b) => b.order - a.order)[0]?.id;
  const expectedImportedPaintLayerNames = photoshopLayerNames.filter((name) => name !== "Image");
  if (
    photoshopImportedProject.shots?.length !== 1 ||
    photoshopImportedLayers.length < 2 ||
    photoshopImportedLayers.length > photoshopLayerNames.length ||
    !photoshopImportedLayerNames.includes("Image") ||
    !expectedImportedPaintLayerNames.some((name) => photoshopImportedLayerNames.includes(name))
  ) {
    throw new Error(
      `Photoshop TIFF round-trip import did not preserve bitmap layers: ${JSON.stringify({
        shotCount: photoshopImportedProject.shots?.length,
        sourceKind: photoshopImportedShot?.swb?.sourceKind,
        layerNames: photoshopImportedLayerNames,
        layerCount: photoshopImportedLayers.length,
        maxExpectedLayerCount: photoshopLayerNames.length,
        expectedImportedPaintLayerNames
      })}`
    );
  }
  if (photoshopImportedShot.activeLayerId !== photoshopImportedTopLayerId) {
    throw new Error(
      `Photoshop TIFF round-trip import did not activate the top layer: ${JSON.stringify({
        activeLayerId: photoshopImportedShot.activeLayerId,
        topLayerId: photoshopImportedTopLayerId,
        layers: photoshopImportedLayers.map((layer) => ({ id: layer.id, order: layer.order }))
      })}`
    );
  }
  const photoshopImportedLayerAssetChecks = await Promise.all(
    photoshopImportedLayers.map(async (layer) => {
      const filePath = resolveLayerPath(photoshopImportRoot, layer.bitmapPath);
      const exists = await fileExists(filePath);
      const nonTransparent = layer.kind === "paint" ? exists && (await hasNonTransparentPixels(filePath)) : exists;
      return {
        id: layer.id,
        kind: layer.kind,
        name: layer.name,
        filePath,
        exists,
        nonTransparent
      };
    })
  );
  if (
    photoshopImportedLayerAssetChecks.some((item) => !item.exists) ||
    !photoshopImportedLayerAssetChecks.some((item) => item.kind === "paint" && item.nonTransparent) ||
    photoshopImportedLayerAssetChecks.some((item) => item.kind === "paint" && !item.nonTransparent)
  ) {
    throw new Error(
      `Photoshop TIFF round-trip import did not create expected layer assets: ${JSON.stringify(
        photoshopImportedLayerAssetChecks
      )}`
    );
  }
  const photoshopImportSourceArchivedPath = await waitFor(
    () => findArchivedFileByHash(photoshopImportRoot, photoshopImportSourceHash),
    "archived Photoshop layered TIFF import source"
  );
  const photoshopImportSourceStillAtRoot = await fileExists(photoshopImportSourcePath);
  if (photoshopImportSourceStillAtRoot) {
    throw new Error("Photoshop layered TIFF import source remained at the folder root");
  }

  await openFolder(smokeRoot);

  // Scenario: Save safety, layered TIFF Save, reopen, animation, and retired legacy input.
  await evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const imageRow = Array.from(document.querySelectorAll(".layer-row"))
        .find((row) => row.querySelector('input[aria-label="Layer name"]')?.value === "Image");
      imageRow.click();

      for (
        let index = 0;
        index < 30 &&
        document.querySelector(".layer-row.is-active input[aria-label='Layer name']")?.value !== "Image";
        index += 1
      ) {
        await delay(100);
      }

      document.querySelector('button[aria-label="Delete current layer"]').click();
      return true;
    })()
  `);

  const imageLayerDeletedMetadata = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const layerIds = project.shots?.[0]?.layers?.map((layer) => layer.id);
    return layerIds && !layerIds.includes("layer-image") && layerIds.length === 2 ? layerIds : undefined;
  }, "Image layer deleted from metadata");
  const imageLayerAssetDeleted = await waitFor(async () => {
    return (await fileExists(layerPath)) ? undefined : true;
  }, "Image layer asset deleted");

	  const projectBeforeConflictSave = await readProjectMetadata(smokeRoot);
	  const conflictExtension = path.extname(projectBeforeConflictSave.shots[1].fileName);
	  const temporaryConflictPath = path.join(
	    smokeRoot,
	    `.storyboard-renaming-${projectBeforeConflictSave.shots[1].id}${conflictExtension}`
	  );
  await writeFile(temporaryConflictPath, "conflict");

  await evaluate(`
    (() => {
      const saveButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Save");
      saveButton.click();
      return true;
    })()
  `);

	  await delay(500);
	  const saveConflictBlocked =
	    (await stat(temporaryConflictPath)
	      .then(() => true)
	      .catch(() => false));
  if (!saveConflictBlocked) {
    throw new Error("Save was not blocked by the temporary rename conflict");
  }
	  const saveConflictStatus = await waitFor(
	    () =>
	      evaluate(`
        (() => {
          const statusButton = document.querySelector('button[aria-label="Workspace status"]');
          if (statusButton.getAttribute("aria-expanded") !== "true") {
            statusButton.click();
          }
          const text = document.querySelector(".status-panel")?.textContent ?? "";
          return text.includes("Save stopped because a temporary rename file already exists") &&
            text.includes("Move or delete the .storyboard-renaming-* file") &&
            text.includes(${JSON.stringify(temporaryConflictPath)});
        })()
	      `),
	    "Save conflict status explains recovery action"
	  );
	  await evaluate(`
	    (() => {
	      const okButton = Array.from(document.querySelectorAll(".save-error-modal button"))
	        .find((button) => button.textContent.trim() === "OK");
	      okButton?.click();
	      return true;
	    })()
	  `);
	  await waitFor(
	    () => evaluate(`!document.querySelector(".save-error-modal")`),
	    "Save conflict dialog dismissed"
	  );

	  await unlink(temporaryConflictPath);
  await waitFor(
    async () => (await fileExists(temporaryConflictPath)) ? undefined : true,
    "temporary rename conflict removed before retrying Save"
  );

  const saveShortcutFromDialogue = await evaluate(`
    (() => {
      const dialogueTextarea = document.querySelector("[data-shot-id] .dialogue-zone textarea");
      if (!dialogueTextarea) {
        return false;
      }
      dialogueTextarea.focus();
      dialogueTextarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          metaKey: true,
          bubbles: true,
          cancelable: true
        })
      );
      return document.activeElement === dialogueTextarea;
    })()
  `);
  if (!saveShortcutFromDialogue) {
    throw new Error("Could not trigger Command+S while the dialogue textarea was focused");
  }
  const saveProgressShown = await waitFor(
    () =>
      evaluate(`
        document.querySelector(".workspace-task-progress")?.textContent.includes("Writing changed TIFFs")
      `),
    "Save progress indicator"
  );

	  await waitFor(async () => {
	    const project = await readProjectMetadata(smokeRoot);
	    const tiffFiles = await findTiffFiles(smokeRoot);
	    return project.shots?.every((shot) => shot.swb?.status === "owned") && tiffFiles.length === 3;
	  }, "Save-owned TIFF and metadata");
	  await waitFor(
	    () => evaluate(`!document.querySelector(".workspace-task-progress")`),
	    "Save progress finished"
	  );

	  const savedProject = await readProjectMetadata(smokeRoot);
  const savedTiffFiles = await findTiffFiles(smokeRoot);
  const firstSavedTiff = savedTiffFiles.find((fileName) => fileName.endsWith("_0010.tiff"));
  if (!firstSavedTiff) {
    throw new Error("Could not find first saved TIFF");
  }
  const firstSavedTopLeftRgb = await topLeftRgb(path.join(smokeRoot, firstSavedTiff));
  if (!firstSavedTopLeftRgb.every((channel) => channel === 255)) {
    throw new Error(`Deleted Image layer still contributed base pixels: ${firstSavedTopLeftRgb.join(",")}`);
  }
  const savedPhotoshopLayerNames = await readPhotoshopLayerNames(path.join(smokeRoot, firstSavedTiff));
  if (savedPhotoshopLayerNames.length !== 2 || savedPhotoshopLayerNames.includes("Image")) {
    throw new Error(
      `Save did not write the current multi-layer shot as editable Photoshop layers: ${savedPhotoshopLayerNames.join(",")}`
    );
  }
  await mkdir(savedLayeredImportRoot, { recursive: true });
  const savedLayeredImportSourcePath = path.join(savedLayeredImportRoot, "saved-layered.tiff");
  await copyFile(path.join(smokeRoot, firstSavedTiff), savedLayeredImportSourcePath);
  const savedLayeredImportSourceHash = await hashFile(savedLayeredImportSourcePath);
  await openFolder(savedLayeredImportRoot, { waitForMetadata: false });
  if (await hashFile(savedLayeredImportSourcePath) !== savedLayeredImportSourceHash) throw new Error("Opening layered input changed original bytes before Import");
  const foreignPreviewPath = previewPathForImage(savedLayeredImportSourcePath, previewRootForFolder(savedLayeredImportRoot));
  const foreignBeforeImport = await waitFor(async () => {
    const facts = await scriptRootUiFacts(savedLayeredImportRoot);
    await writeFile(path.join(scriptRootImportEvidenceRoot, "foreign-layered-before-import.json"), JSON.stringify(facts ?? null, null, 2));
    return facts?.projectObserved && facts.shots.length === 1 && facts.shots[0].imagePath === savedLayeredImportSourcePath &&
      facts.shots[0].previewPath === foreignPreviewPath && facts.shots[0].swb?.status === "non-swb" &&
      facts.previews.every(Boolean) && facts.importEnabled ? facts : undefined;
  }, "new foreign folder actually published with decoded preview, not old shot stage");
  if (Object.keys(foreignBeforeImport.pendingBake?.shots ?? {}).length || (await sharp(foreignPreviewPath).metadata()).width <= 0) {
    throw new Error("Foreign preview falsely acquired output proof or failed decoding");
  }
  for (const protectedPath of [path.join(savedLayeredImportRoot, ".storyboard-workbench/storyboard.project.json"),
    path.join(savedLayeredImportRoot, ".storyboard-workbench/layers"), path.join(savedLayeredImportRoot, "storyboard-script.md")]) {
    if (await fileExists(protectedPath)) throw new Error(`Open adopted foreign assets before explicit Import: ${protectedPath}`);
  }
  await waitFor(
    () =>
      evaluate(`
        (() => {
          const importButton = Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent.trim() === "Import");
          return Boolean(importButton && !importButton.disabled);
        })()
      `),
    "saved layered TIFF import button enabled"
  );
  await evaluate(`
    (() => {
      const importButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Import");
      importButton.click();
      return true;
    })()
  `);
  const savedLayeredImportedProject = await waitFor(async () => {
    const project = await readProjectMetadata(savedLayeredImportRoot);
    const shot = project.shots?.[0];
    return shot?.swb?.sourceKind === "photoshop-layered-tiff" &&
      (shot.layers?.length ?? 0) > 0
      ? project
      : undefined;
  }, "Save-produced Photoshop layered TIFF import", 20000);
  const savedLayeredImportedLayerNames = savedLayeredImportedProject.shots?.[0]?.layers?.map((layer) => layer.name) ?? [];
  const importedLayeredShot = savedLayeredImportedProject.shots[0];
  if (JSON.stringify(savedLayeredImportedLayerNames) !== JSON.stringify(savedPhotoshopLayerNames) || importedLayeredShot.layers.length !== 2 ||
      savedLayeredImportedProject.pendingBake?.shots[importedLayeredShot.id]?.state !== "pending") {
    throw new Error("Explicit layered Import did not preserve both Photoshop layers and pending output obligation");
  }
  for (let index = 0; index < 2; index++) {
    const originalLayer = savedProject.shots[0].layers[index], importedLayer = importedLayeredShot.layers[index];
    const originalPixels = await sharp(resolveLayerPath(smokeRoot, originalLayer.bitmapPath)).ensureAlpha().raw().toBuffer();
    const importedPixels = await sharp(resolveLayerPath(savedLayeredImportRoot, importedLayer.bitmapPath)).ensureAlpha().raw().toBuffer();
    // The existing TIFF exporter encodes opacity in alpha (float32 rounded to
    // uint8) and imports that raster at opacity=1. Compare rendered layer inputs,
    // not the pre-export alpha which would incorrectly apply opacity twice.
    if (originalPixels.length !== importedPixels.length || importedLayer.opacity !== 1 ||
        importedLayer.blendMode !== originalLayer.blendMode || !originalPixels.every((value, channel) =>
          channel % 4 === 3 ? Math.abs(importedPixels[channel] - value * originalLayer.opacity) <= 1 : importedPixels[channel] === value)) {
      throw new Error(`Layered Import pixel/opacity/blend mismatch at layer ${index}`);
    }
  }
  const savedLayeredImportSourceArchivedPath = await waitFor(
    () => findArchivedFileByHash(savedLayeredImportRoot, savedLayeredImportSourceHash),
    "archived Save-produced Photoshop layered TIFF source"
  );
  const archivedShotAPath = await waitFor(
    () => findArchivedFileByHash(smokeRoot, originalShotAHash),
    "archived original shot"
  );
  const archivedShotAHash = await hashFile(archivedShotAPath);
  if (archivedShotAHash !== originalShotAHash) {
    throw new Error("Save modified the archived original image");
  }
  const savedPaintLayerHash = await hashFile(paintLayerPath);
  if (savedPaintLayerHash !== paintDrawnHash) {
    throw new Error("Save changed the editable paint layer asset hash");
  }

  await evaluate("location.reload()");
  await openFolder();

  const reopenedProject = await readProjectMetadata(smokeRoot);
  const reopenedLayerIds = reopenedProject.shots?.[0]?.layers?.map((layer) => layer.id);
  if (reopenedLayerIds.includes("layer-image")) {
    throw new Error("Reopen restored a deleted Image layer");
  }
  const reopenedPaintLayer = reopenedProject.shots?.[0]?.layers?.find((item) => item.id === paintLayer.id);
  if (!reopenedPaintLayer || reopenedPaintLayer.opacity !== 0.35 || reopenedPaintLayer.blendMode !== "multiply") {
    throw new Error("Reopen did not preserve paint layer metadata");
  }
  const reopenedPaintHash = await hashFile(resolveLayerPath(smokeRoot, reopenedPaintLayer.bitmapPath));
  if (reopenedPaintHash !== paintDrawnHash) {
    throw new Error("Reopen did not preserve the editable paint layer asset hash");
  }
  await evaluate(`
    (() => {
      if (document.querySelector(".layer-panel")) {
        document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]')?.click();
      }
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`!document.querySelector(".layer-panel")`),
    "layer panel closed before animation smoke"
  );

  const expectedRatios = (await readProjectMetadata(smokeRoot)).shots.map((shot) =>
    (shot.swb?.canvasWidth ?? 1) / (shot.swb?.canvasHeight ?? 1)
  );
  const animationSetupChecks = await evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedRatios = ${JSON.stringify(expectedRatios)};
      const onionToggleHiddenBeforeAnimation = !document.querySelector(".onion-skin-toggle");
      const slider = document.querySelector('input[type="range"]');
      const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      rangeSetter.call(slider, "260");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));

      for (let index = 0; index < 30 && !document.querySelector(".timeline"); index += 1) {
        await delay(100);
      }

      const timelineButtons = Array.from(document.querySelectorAll(".timeline-shot"));
      if (timelineButtons.length !== 3) {
        throw new Error("Timeline did not render all three shots");
      }

      const stageRatioForTimelineIndex = async (index) => {
        timelineButtons[index].click();
        let lastRatio = 0;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await delay(100);
          const stage = document.querySelector(".shot-card.is-animation-focus .image-stage");
          if (!stage) {
            continue;
          }
          const rect = stage.getBoundingClientRect();
          lastRatio = rect.width / rect.height;
          if (Math.abs(lastRatio - expectedRatios[index]) <= 0.04) {
            return lastRatio;
          }
        }
        return lastRatio;
      };

      const aspectRatios = [
        await stageRatioForTimelineIndex(0),
        await stageRatioForTimelineIndex(1),
        await stageRatioForTimelineIndex(2)
      ];

      timelineButtons[1].click();
      await delay(250);
      const checkbox = document.querySelector('.onion-skin-toggle input[type="checkbox"]');
      checkbox.click();

      for (
        let index = 0;
        index < 30 &&
        !(
          document.querySelectorAll(".onion-skin-ghost").length === 2 &&
          Array.from(document.querySelectorAll(".onion-skin-ghost")).every(
            (ghost) => ghost.querySelectorAll("img").length >= 1
          )
        );
        index += 1
      ) {
        await delay(100);
      }

      const ghostInfoBefore = Array.from(document.querySelectorAll(".onion-skin-ghost")).map((ghost) => ({
        className: ghost.className,
        opacity: getComputedStyle(ghost).opacity,
        filter: getComputedStyle(ghost).filter,
        imageCount: ghost.querySelectorAll("img").length
      }));

      document.querySelector('input[type="range"]').focus();

      return {
        onionToggleHiddenBeforeAnimation,
        renderedShotCount: document.querySelectorAll("[data-shot-id]").length,
        aspectRatios,
        ghostInfoBefore,
        focusedBeforeTimelineKeys: {
          tagName: document.activeElement?.tagName,
          type: document.activeElement?.getAttribute("type")
        }
      };
    })()
  `);

  await dispatchKey(send, "ArrowRight", "ArrowRight", 39);
  await delay(250);
  const animationRightChecks = await evaluate(`
    (() => ({
      selectedAfterRight: document.querySelector(".timeline-shot.is-selected span")?.textContent,
      ghostCountAfterRight: document.querySelectorAll(".onion-skin-ghost").length
    }))()
  `);

  await dispatchKey(send, "ArrowLeft", "ArrowLeft", 37);
  await delay(250);
  const animationLeftChecks = await evaluate(`
    (() => {
      const timelineRect = document.querySelector(".timeline").getBoundingClientRect();
      return {
        selectedAfterLeft: document.querySelector(".timeline-shot.is-selected span")?.textContent,
        ghostCountAfterLeft: document.querySelectorAll(".onion-skin-ghost").length,
        timelineVisible: timelineRect.height > 0 && timelineRect.bottom <= window.innerHeight
      };
    })()
  `);
  const animationChecks = {
    ...animationSetupChecks,
    ...animationRightChecks,
    ...animationLeftChecks
  };

  animationChecks.aspectRatios.forEach((ratio, index) => {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      throw new Error(`Animation stage ratio was invalid for shot ${index + 1}: ${ratio}`);
    }
  });
  const animationAspectRatioChecks = {
    actual: animationChecks.aspectRatios,
    expected: expectedRatios
  };
  if (
    animationChecks.ghostInfoBefore.length !== 2 ||
    !animationChecks.ghostInfoBefore.every((ghost) => ghost.opacity === "0.28" && ghost.imageCount >= 1) ||
    !animationChecks.ghostInfoBefore.some((ghost) => ghost.className.includes("previous")) ||
    !animationChecks.ghostInfoBefore.some((ghost) => ghost.className.includes("next")) ||
    !animationChecks.onionToggleHiddenBeforeAnimation ||
    animationChecks.selectedAfterRight !== "003" ||
    animationChecks.ghostCountAfterRight !== 1 ||
    animationChecks.selectedAfterLeft !== "002" ||
    animationChecks.ghostCountAfterLeft !== 2 ||
    animationChecks.renderedShotCount !== 1 ||
    !animationChecks.timelineVisible
  ) {
    throw new Error(`Animation/onion skin check failed: ${JSON.stringify(animationChecks)}`);
  }

  const addShotUiCount = await evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const beforeTimelineCount = document.querySelectorAll(".timeline-shot").length;
      const addShotMenuToggle = document.querySelector(".add-shot-menu-toggle");
      addShotMenuToggle.click();
      await delay(50);
      const theatricalPreset = document.querySelector('[data-blank-shot-preset="1.85:1"]');
      theatricalPreset.click();
      await delay(50);
      const addShotButton = document.querySelector(".add-shot-main-button");
      addShotButton.click();

      for (let index = 0; index < 30 && document.querySelectorAll(".timeline-shot").length !== beforeTimelineCount + 1; index += 1) {
        await delay(100);
      }

      return {
        boardShotCount: document.querySelectorAll("[data-shot-id]").length,
        timelineShotCount: document.querySelectorAll(".timeline-shot").length
      };
    })()
  `);
  if (addShotUiCount.boardShotCount !== 1 || addShotUiCount.timelineShotCount !== 4) {
    throw new Error(`Add Shot did not update the storyboard UI: ${JSON.stringify(addShotUiCount)}`);
  }

  const addedShotProject = await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const tiffFiles = await findTiffFiles(smokeRoot);
    return project.shots?.length === 4 && tiffFiles.length === 4 ? project : undefined;
  }, "Add Shot metadata and TIFF file");
  const addedTheatricalShot = addedShotProject.shots.find(
    (shot) => shot.swb?.canvasWidth === 1998 && shot.swb?.canvasHeight === 1080
  );
  if (!addedTheatricalShot) {
    throw new Error(`Add Shot did not create 1.85:1 metadata: ${JSON.stringify(addedShotProject)}`);
  }
  const addedTheatricalTiff = await sharp(addedTheatricalShot.imagePath).metadata();
  if (addedTheatricalTiff.width !== 1998 || addedTheatricalTiff.height !== 1080) {
    throw new Error(`Add Shot did not create a 1998x1080 TIFF: ${JSON.stringify(addedTheatricalTiff)}`);
  }

  // Old project artwork remains browsable without migrating or writing its
  // metadata. Closing the browser restores the current editable workspace.
  const legacyBefore = { sourceHash: await hashFile(legacyImagePath), projectHash: await hashFile(projectMetadataPath(legacyRoot)) };
  const previousShotIds = await evaluate(`Array.from(document.querySelectorAll('[data-shot-id]')).map(node => node.dataset.shotId)`);
  await openFolder(legacyRoot, { expectOpened: false });
  const legacyProtectionStatus = await waitFor(() => evaluate(`(() => {
    const browser = document.querySelector('.folder-image-browser');
    const text = browser?.textContent ?? '';
    const modal = Boolean(document.querySelector('.save-error-modal'));
    const images = [...(browser?.querySelectorAll('img') ?? [])];
    return browser?.open && images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0) && !modal ? { text, modal, previews: images.length } : undefined;
  })()`), "old project displays image previews without Save-failure modal");
  await evaluate(`Array.from(document.querySelectorAll('.folder-image-browser button')).find(button => button.textContent === 'Back to workspace')?.click()`);
  await waitFor(() => evaluate(`!document.querySelector('.folder-image-browser')`), "close image browser");
  const currentShotIds = await evaluate(`Array.from(document.querySelectorAll('[data-shot-id]')).map(node => node.dataset.shotId)`);
  if (JSON.stringify(currentShotIds) !== JSON.stringify(previousShotIds)) throw new Error('Unsupported old project replaced the displayed project');
  const legacyAfter = { sourceHash: await hashFile(legacyImagePath), projectHash: await hashFile(projectMetadataPath(legacyRoot)) };
  if (JSON.stringify(legacyBefore) !== JSON.stringify(legacyAfter) || (await scriptRootUiFacts(legacyRoot))?.projectObserved) {
    throw new Error("Unproved legacy Open mutated or falsely published the unknown project");
  }
  for (const forbidden of [".storyboard-workbench/layers", ".storyboard-workbench/previews", "storyboard-script.md", "Archive", "Photoshop TIFF Export"]) {
    if (await fileExists(path.join(legacyRoot, forbidden))) throw new Error(`Unproved legacy Open created ${forbidden}`);
  }
  if ((await findTiffFiles(legacyRoot)).length) throw new Error("Unproved legacy Open created working TIFFs");
  const legacyProtectionChecks = { ...legacyAfter, unchanged: true, notPublished: true, status: legacyProtectionStatus };
  await writeFile(path.join(scriptRootImportEvidenceRoot, "legacy-protection.json"), JSON.stringify({ before: legacyBefore, after: legacyProtectionChecks }, null, 2));

  const finalProject = await readProjectMetadata(smokeRoot);
  const layerAssetConsistency = await assertNoUnreferencedLayerAssets(smokeRoot, finalProject);

  ws.close();

  console.log(
    JSON.stringify(
      {
        focusChecks,
        folderPath: smokeRoot,
        layerPath,
        beforeHash,
        drawnHash,
        undoHash,
        redoHash,
	        secondShotBeforeHash,
	        thirdShotBeforeHash,
	        scriptBackChecks,
	        parkingChecks: {
	          afterPark: parkingAfterPark,
	          afterRestore: parkingAfterRestore,
	          whilePinnedOpen: parkingWhilePinnedOpen
	        },
        clipboardChecks: {
          loadedShotCount: clipboardProjectLoaded.shots.length,
          storyboardPasteChecks,
          altDragNoCopyChecks
        },
	        externalImageWarning: {
          shotCount: externalImageWarningProject.shots.length,
          appendedStatuses: externalImageWarningProject.shots.slice(-2).map((shot) => shot.swb.status)
        },
        deleteShotChecks: {
          pendingIds: deletePendingProject.pendingDeletedShots.map((shot) => shot.id),
          savedShotCount: deleteSavedProject.shots.length,
          deletedFileStillExists: await fileExists(deleteTargetPath),
          layerDirExistsBeforeDelete: deleteLayerDirExistsBeforeDelete,
          layerDirExistsBeforeSave: deleteLayerDirExistsBeforeSave,
          layerDirExistsAfterUndo: deleteLayerDirExistsAfterUndo,
          layerDirExistsAfterSave: await fileExists(deleteTargetLayerDir),
          deleteInScriptTextareaKeptCards
        },
        denseMarqueeChecks: denseMarqueeDuringDrag,
        erasedHash,
        undoEraseHash,
        clearedHash,
        undoClearHash,
        imageOnlyDeleteDisabled,
        imageLayerDeletedMetadata,
        imageLayerAssetDeleted,
        paintLayerPath,
        paintBlankHash,
        paintDrawnHash,
        paintThumbnailLoaded,
        paintErasedHash,
        paintUndoEraseHash,
        paintLassoMovedHash,
        paintUndoLassoMoveHash,
        selectionClearedAfterToolSwitch,
        paintRectangleScaledHash,
        paintUndoRectangleScaleHash,
        paintOpacity: paintMetadata.opacity,
        paintBlendMode: paintMetadata.blendMode,
        paintBlendDotUpdated,
        paintBlendModeAppliedToStage,
        paintOpacityFillUpdated,
        layerLockChecks,
        addLayerUndoChecks,
        addLayerRedoChecks,
	        mergeDownChecks,
	        mergeUndoChecks,
	        mergeRedoChecks,
	        mergeVisibleChecks,
	        mergeVisibleUndoChecks,
	        paintLayerDragPreviewVisible,
        keyboardShortcutChecks,
        sketchSettingsOpensOnStage,
        sketchSettingsIgnoredOutsideStage,
        zDragZoomChecks,
        japaneseSpacePanChecks,
        dialogueRowChecks,
        layerToggleClickClosedPanel,
        layerToggleBottomStableAfterClose,
        layerRowsKeepFixedHeight,
        layerListWheelPreservedZoom,
        layerVisibilityDragChecks,
        layerMultiSelectChecks,
        layerMultiOpacityChecks,
        layerMultiDragPreviewVisible,
        layerMultiReorderChecks,
        paintOrderBeforeDrag,
        paintOrderAfterDrag,
        paintOrderAfterBottomBlankDrag,
        layerPasteChecks,
        layerPasteCleanupChecks,
        photoshopExportFiles,
        photoshopLayerNames,
        importProgressShown,
        photoshopRoundTripImport: {
          folderPath: photoshopImportRoot,
          sourceArchivedPath: photoshopImportSourceArchivedPath,
          layerNames: photoshopImportedLayerNames,
          activeLayerId: photoshopImportedShot.activeLayerId,
          layerAssetChecks: photoshopImportedLayerAssetChecks,
          sourceKind: photoshopImportedShot.swb.sourceKind
        },
        saveConflictBlocked,
        saveConflictStatus,
        saveProgressShown,
        firstSavedTopLeftRgb,
        savedPhotoshopLayerNames,
        savedLayeredImport: {
          folderPath: savedLayeredImportRoot,
          sourceArchivedPath: savedLayeredImportSourceArchivedPath,
          layerNames: savedLayeredImportedLayerNames
        },
        archivedShotAHash,
        savedFileNames: savedTiffFiles,
        savedSwbStatuses: savedProject.shots.map((shot) => shot.swb.status),
        reopenedLayerIds,
        reopenedPaintHash,
        animationChecks,
        animationAspectRatioChecks,
        addShotUiCount,
        layerAssetConsistency,
        legacyProtection: legacyProtectionChecks
      },
      null,
      2
    )
  );
} finally {
  storyboardSocket?.close();
  if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
    const exited = new Promise((resolve) => electronProcess.once("exit", resolve));
    electronProcess.kill();
    await Promise.race([exited, delay(2000)]);
    if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
      // Exact spawned test instance only. Forced fixture cleanup is never a
      // native Close or Save-and-Close business PASS.
      electronProcess.kill("SIGKILL");
      await Promise.race([exited, delay(2000)]);
    }
  }
  // Helper processes can briefly inherit the child pipes. Do not keep the Node
  // harness alive waiting for unrelated pipe EOF after the owned launch exits.
  electronProcess?.stdout?.destroy();
  electronProcess?.stderr?.destroy();
  await rm(smokeRoot, { recursive: true, force: true });
  await rm(scriptRoot, { recursive: true, force: true });
  await rm(scriptRootImportEvidenceRoot, { recursive: true, force: true });
  await rm(mdBootstrapRoot, { recursive: true, force: true });
  await rm(mdBootstrapTargetRoot, { recursive: true, force: true });
  await rm(mdEmbeddedMatteTargetRoot, { recursive: true, force: true });
  await rm(deleteRoot, { recursive: true, force: true });
  await rm(clipboardRoot, { recursive: true, force: true });
  await rm(legacyRoot, { recursive: true, force: true });
  await rm(photoshopImportRoot, { recursive: true, force: true });
  await rm(savedLayeredImportRoot, { recursive: true, force: true });
}
