import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeRoot = path.join("/private/tmp", `swb-bitmap-smoke-${Date.now()}`);
const scriptRoot = path.join("/private/tmp", `swb-script-smoke-${Date.now()}`);
const deleteRoot = path.join("/private/tmp", `swb-delete-smoke-${Date.now()}`);
const legacyRoot = path.join("/private/tmp", `swb-legacy-smoke-${Date.now()}`);
const photoshopImportRoot = path.join("/private/tmp", `swb-photoshop-import-${Date.now()}`);
const savedLayeredImportRoot = path.join("/private/tmp", `swb-saved-layered-import-${Date.now()}`);
const port = String(9300 + Math.floor(Math.random() * 400));
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");
const photoshopPythonDepsDir = process.env.SWB_PYTHON_DEPS_DIR ?? "/private/tmp/psdtags-spike-deps";

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
    return pages.find((item) => item.title === "Storyboard Workbench" && item.webSocketDebuggerUrl);
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

const waitForUndoReady = async () => {
  await delay(700);
};

const dragStroke = async (send, startX, startY, endX, endY) => {
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

  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: endX,
    y: endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
};

const liveBitmapCanvasSnapshot = (evaluate) =>
  evaluate(`
    (() => {
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

try {
  // Fixture setup.
  await mkdir(smokeRoot, { recursive: true });
  await mkdir(scriptRoot, { recursive: true });
  await mkdir(deleteRoot, { recursive: true });
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
  await send("Page.enable");
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Page.javascriptDialogOpening") {
      void send("Page.handleJavaScriptDialog", { accept: true });
    }
  });

  // Scenario: open a normal image folder and verify basic rendering.
  const openFolder = async (folderPath = smokeRoot) => {
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
      input.closest("form").requestSubmit();
      return input.value;
    })()
  `);

    await waitFor(
      () =>
        evaluate(`
        Boolean(document.querySelector(".image-stage"))
      `),
      "shot stage"
    );

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

  await openFolder(scriptRoot);

  // Scenario: storyboard script back side and root markdown sync/import.
  const scriptMarkdownPath = path.join(scriptRoot, "storyboard-script.md");
  await evaluate(`
    (() => {
      document.querySelector(".tool-rail .card-face-tool").click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector("[data-shot-id]")?.classList.contains("is-script-face")`),
    "storyboard script side visible"
  );
  const scriptCardGeometry = await evaluate(`
    (() => Array.from(document.querySelectorAll(".shot-card.is-script-face")).map((card) => {
      const cardRect = card.getBoundingClientRect();
      const textareaRect = card.querySelector(".shot-script-textarea")?.getBoundingClientRect();
      return {
        shotId: card.getAttribute("data-shot-id"),
        cardBottom: cardRect.bottom,
        textareaBottom: textareaRect?.bottom ?? null,
        textareaWithinCard: textareaRect ? textareaRect.bottom <= cardRect.bottom + 1 : false
      };
    }))()
  `);
  if (scriptCardGeometry.some((item) => !item.textareaWithinCard)) {
    throw new Error(`Script textarea overflowed card bounds: ${JSON.stringify(scriptCardGeometry)}`);
  }
  await evaluate(`
    (() => {
      const textarea = document.querySelector(".shot-script-textarea");
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
    ["1. New exterior beat", "2. Opening shot", "   Camera pushes in", "3. "].join("\n") + "\n",
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
  if (!importHelpText.includes("原始 TIFF") ||
    !importHelpText.includes("Archive") ||
    !importHelpText.includes("storyboard-script.md") ||
    !importHelpText.includes("点击 Import")) {
    throw new Error(`Import help popover copy was incomplete: ${importHelpText}`);
  }
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
  await evaluate(`document.querySelector(".shot-script-textarea")?.focus()`);
  await dispatchKey(send, "Backspace", "Backspace", 8);
  const deleteInScriptTextareaKeptCards = await evaluate(
    `document.querySelectorAll("[data-shot-id]").length`
  );
  if (deleteInScriptTextareaKeptCards !== scriptImportedProject.shots.length) {
    throw new Error("Delete inside script textarea removed a storyboard card");
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
  await evaluate(`
    (() => {
      const button = document.querySelector(".tool-rail .card-face-tool");
      if (button.textContent.trim() === "图") {
        button.click();
      }
      return true;
    })()
  `);

  // Scenario: Delete removes selected storyboards in the app, Undo restores them, and Save moves files to Trash.
  await openFolder(deleteRoot);
  const deleteInitialProject = await readProjectMetadata(deleteRoot);
  const deleteTargetPath = deleteInitialProject.shots[1].imagePath;
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
      !(await fileExists(deleteTargetPath))
      ? project
      : undefined;
  }, "Save moved deleted storyboard file to Trash", 20000);

  await openFolder();

  // Scenario: drawing, erasing, undo/redo, layer drawer, and shortcuts.
  const exportTiffButtonVisible = await evaluate(`
    Array.from(document.querySelectorAll("button"))
      .some((button) => button.textContent.trim() === "Export TIFF")
  `);
  if (exportTiffButtonVisible) {
    throw new Error("Export TIFF button should not be visible in the main window");
  }

  const layerPath = await waitFor(() => findShotLayerMetadataPath(smokeRoot, 0), "image layer metadata path");
  const secondShotLayerPath = await waitFor(() => findShotLayerMetadataPath(smokeRoot, 1), "second shot image layer metadata path");
  const thirdShotLayerPath = await waitFor(() => findShotLayerMetadataPath(smokeRoot, 2), "third shot image layer metadata path");
  const beforeHash = await layerAssetState(layerPath);
  const secondShotBeforeHash = await layerAssetState(secondShotLayerPath);
  const thirdShotBeforeHash = await layerAssetState(thirdShotLayerPath);

  const rect = await evaluate(`
    (() => {
      const stage = document.querySelector(".image-stage");
      const rect = stage.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()
  `);
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
      return !document.querySelector(".sketch-settings-menu");
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
          return Boolean(document.querySelector(".sketch-settings-menu"));
        })()
      `),
    "sketch settings menu opens on stage"
  );
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitFor(
    () => evaluate(`!document.querySelector(".sketch-settings-menu")`),
    "sketch settings menu closed after stage check"
  );

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
          return Boolean(document.querySelector('input[aria-label="Brush shortcut"]'));
        })()
      `);
      if (!opened) {
        return undefined;
      }
      await evaluate(`
        window.storyboard.setKeyboardShortcuts({
          brush: "P",
          eraser: "E",
          select: "V",
          clearLayer: "Escape",
          save: "Cmd+S",
          addShot: "A",
          onionSkin: "O",
          previousShot: "ArrowLeft",
          nextShot: "ArrowRight",
          undo: "Cmd+Z",
          redo: "Shift+Cmd+Z"
        })
      `);
      const settings = await waitFor(async () => {
        const contents = await readFile(path.join(electronUserDataRoot, "keyboard-shortcuts.json"), "utf8")
          .catch(() => undefined);
        if (!contents) {
          return undefined;
        }
        const parsed = JSON.parse(contents);
        return parsed.brush === "P" && parsed.clearLayer === "Escape" ? parsed : undefined;
      }, "keyboard shortcut settings file");
      const readback = await evaluate(`window.storyboard.getKeyboardShortcuts()`);
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
        menuOpened: opened,
        savedBrush: settings.brush,
        savedClearLayer: settings.clearLayer,
        readbackBrush: readback.brush,
        readbackClearLayer: readback.clearLayer
      };
    },
    "keyboard shortcut editor"
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
          const checks = {
            hasDelete: Boolean(firstShot?.querySelector('.shot-layer-popover button[aria-label="Delete current layer"]')),
            noFixedPopover: !document.body.querySelector(':scope > .layer-popover'),
            hasRects: Boolean(stageRect && dialogueRect && panelRect && toggleRect && footerButtonRect),
            panelAligned: Boolean(stageRect && panelRect && panelRect.left >= stageRect.right - 1),
            panelBottomAligned: Boolean(dialogueRect && panelRect && Math.abs(panelRect.bottom - dialogueRect.bottom) <= 2),
            toggleAttachedToPanelRight: Boolean(panelRect && toggleRect && Math.abs(toggleRect.left - panelRect.right) <= 1),
            toggleBottomAligned: Boolean(stageRect && toggleRect && Math.abs(toggleRect.bottom - stageRect.bottom) <= 1),
            toggleVertical: Boolean(toggleRect && toggleRect.height > toggleRect.width),
            footerCompact: Boolean(footerButtonRect && footerButtonRect.height <= 20),
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
          zone.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
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
    return !layerIds.includes(secondPaintLayer.id) && assetState === secondPaintLayerAssetState
      ? { metadataRemoved: true, assetUnchanged: true }
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
      const zoom = document.querySelector('input[type="range"]');
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
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: layerVisibilityHideDrag.startX,
    y: layerVisibilityHideDrag.startY,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: layerVisibilityHideDrag.endX,
    y: layerVisibilityHideDrag.endY,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: layerVisibilityHideDrag.endX,
    y: layerVisibilityHideDrag.endY,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
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

  await openFolder(photoshopImportRoot);
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

  // Scenario: Save safety, layered TIFF Save, reopen, animation, and legacy migration.
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
  const temporaryConflictPath = path.join(
    smokeRoot,
    `.storyboard-renaming-${projectBeforeConflictSave.shots[1].id}.png`
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
    (await findTiffFiles(smokeRoot)).length === 0 &&
    (await stat(temporaryConflictPath)
      .then(() => true)
      .catch(() => false));
  if (!saveConflictBlocked) {
    throw new Error("Save was not blocked by the temporary rename conflict");
  }

  await unlink(temporaryConflictPath);

  await evaluate(`
    (() => {
      const saveButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Save");
      saveButton.click();
      return true;
    })()
  `);
  const saveProgressShown = await waitFor(
    () =>
      evaluate(`
        document.querySelector(".workspace-task-progress")?.textContent.includes("Saving layered TIFFs")
      `),
    "Save progress indicator"
  );

  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const tiffFiles = await findTiffFiles(smokeRoot);
    return project.shots?.every((shot) => shot.swb?.status === "owned") && tiffFiles.length === 3;
  }, "Save-owned TIFF and metadata");

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
  await openFolder(savedLayeredImportRoot);
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

  const animationSetupChecks = await evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
        await delay(250);
        const rect = document.querySelector(".image-stage").getBoundingClientRect();
        return rect.width / rect.height;
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

  const expectedRatios = [320 / 180, 430 / 180, 258 / 180];
  animationChecks.aspectRatios.forEach((ratio, index) => {
    if (Math.abs(ratio - expectedRatios[index]) > 0.04) {
      throw new Error(`Animation stage ratio mismatch for shot ${index + 1}: ${ratio}`);
    }
  });
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
      const addShotButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Add Shot");
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

  await waitFor(async () => {
    const project = await readProjectMetadata(smokeRoot);
    const tiffFiles = await findTiffFiles(smokeRoot);
    return project.shots?.length === 4 && tiffFiles.length === 4 ? project : undefined;
  }, "Add Shot metadata and TIFF file");

  await openFolder(legacyRoot);
  const legacyProject = await waitFor(async () => {
    const project = await readProjectMetadata(legacyRoot);
    const shot = project.shots?.[0];
    return shot?.layers?.length === 2 && shot.layers.some((layer) => layer.id === "legacy-ink")
      ? project
      : undefined;
  }, "legacy bitmap metadata autosave");
  await exportPhotoshopTiffsViaDebugApi(legacyRoot);
  await waitFor(async () => {
    const files = await findPhotoshopExportFiles(legacyRoot);
    return files.length === 1 ? files : undefined;
  }, "legacy Photoshop TIFF export files");
  const legacyImageLayerPath = await waitFor(
    () => findShotLayerPath(legacyRoot, 0),
    "legacy image layer asset"
  );
  const legacyPaintLayerPath = await waitFor(
    () => findShotLayerPath(legacyRoot, 0, "legacy-ink"),
    "legacy paint layer asset"
  );
  const legacyBaseHash = await hashFile(legacyImagePath);
  const legacyImageLayerHash = await hashFile(legacyImageLayerPath);
  const legacyPaintLayerHash = await hashFile(legacyPaintLayerPath);
  if (legacyImageLayerHash === legacyBaseHash || legacyPaintLayerHash === paintBlankHash) {
    throw new Error("Legacy stroke migration did not create visible bitmap layer pixels");
  }

  const finalProject = await readProjectMetadata(smokeRoot);
  const layerAssetConsistency = await assertNoUnreferencedLayerAssets(smokeRoot, finalProject);

  ws.close();

  console.log(
    JSON.stringify(
      {
        folderPath: smokeRoot,
        layerPath,
        beforeHash,
        drawnHash,
        undoHash,
        redoHash,
        secondShotBeforeHash,
        thirdShotBeforeHash,
        scriptBackChecks,
        externalImageWarning: {
          shotCount: externalImageWarningProject.shots.length,
          appendedStatuses: externalImageWarningProject.shots.slice(-2).map((shot) => shot.swb.status)
        },
        deleteShotChecks: {
          pendingIds: deletePendingProject.pendingDeletedShots.map((shot) => shot.id),
          savedShotCount: deleteSavedProject.shots.length,
          deletedFileStillExists: await fileExists(deleteTargetPath),
          deleteInScriptTextareaKeptCards
        },
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
        paintLayerDragPreviewVisible,
        keyboardShortcutChecks,
        sketchSettingsOpensOnStage,
        sketchSettingsIgnoredOutsideStage,
        dialogueRowChecks,
        layerToggleClickClosedPanel,
        layerToggleBottomStableAfterClose,
        layerRowsKeepFixedHeight,
        layerListWheelPreservedZoom,
        layerVisibilityDragChecks,
        paintOrderBeforeDrag,
        paintOrderAfterDrag,
        paintOrderAfterBottomBlankDrag,
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
        addShotUiCount,
        layerAssetConsistency,
        legacyMigration: {
          layerIds: legacyProject.shots[0].layers.map((layer) => layer.id),
          legacyImageLayerHash,
          legacyPaintLayerHash
        }
      },
      null,
      2
    )
  );
} finally {
  electronProcess?.kill();
  await rm(smokeRoot, { recursive: true, force: true });
  await rm(scriptRoot, { recursive: true, force: true });
  await rm(deleteRoot, { recursive: true, force: true });
  await rm(legacyRoot, { recursive: true, force: true });
  await rm(photoshopImportRoot, { recursive: true, force: true });
  await rm(savedLayeredImportRoot, { recursive: true, force: true });
}
