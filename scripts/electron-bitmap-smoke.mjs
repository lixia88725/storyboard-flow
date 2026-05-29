import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeRoot = path.join("/private/tmp", `swb-bitmap-smoke-${Date.now()}`);
const legacyRoot = path.join("/private/tmp", `swb-legacy-smoke-${Date.now()}`);
const port = String(9300 + Math.floor(Math.random() * 400));
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");

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

const resolveLayerPath = (folderPath, bitmapPath) => path.join(folderPath, bitmapPath);

const projectMetadataPath = (folderPath) =>
  path.join(folderPath, ".storyboard-workbench", "storyboard.project.json");

const readProjectMetadata = async (folderPath) =>
  JSON.parse(await readFile(projectMetadataPath(folderPath), "utf8"));

const findTiffFiles = async (folderPath) =>
  (await readdir(folderPath)).filter((fileName) => /\.(tif|tiff)$/i.test(fileName));

const fileExists = async (filePath) =>
  stat(filePath)
    .then(() => true)
    .catch(() => false);

const topLeftRgb = async (filePath) => {
  const { data } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  return Array.from(data.slice(0, 3));
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
  await mkdir(smokeRoot, { recursive: true });
  const originalShotAPath = path.join(smokeRoot, "shot_a.png");
  const originalShotBPath = path.join(smokeRoot, "shot_b.png");
  const originalShotCPath = path.join(smokeRoot, "shot_c.png");
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

  electronProcess = spawn(electronBin, [`--remote-debugging-port=${port}`, "."], {
    cwd: repoRoot,
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
  };

  await openFolder();

  const layerPath = await waitFor(() => findShotLayerPath(smokeRoot, 0), "image layer asset");
  const secondShotLayerPath = await waitFor(() => findShotLayerPath(smokeRoot, 1), "second shot image layer asset");
  const thirdShotLayerPath = await waitFor(() => findShotLayerPath(smokeRoot, 2), "third shot image layer asset");
  const beforeHash = await hashFile(layerPath);
  const secondShotBeforeHash = await hashFile(secondShotLayerPath);
  const thirdShotBeforeHash = await hashFile(thirdShotLayerPath);

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

  const startX = Math.round(rect.x + rect.width * 0.35);
  const startY = Math.round(rect.y + rect.height * 0.45);
  const endX = Math.round(rect.x + rect.width * 0.65);
  const endY = Math.round(rect.y + rect.height * 0.55);

  await dragStroke(send, startX, startY, endX, endY);

  const drawnHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash !== beforeHash ? nextHash : undefined;
  }, "layer hash change after drawing");

  await dispatchKeyZ(send, 4);

  const undoHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash === beforeHash ? nextHash : undefined;
  }, "layer hash restore after undo");

  await delay(500);
  await dispatchKeyZ(send, 12);

  const redoHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after redo");

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Eraser"]').click();
      return true;
    })()
  `);

  await dragStrokeWithLiveBitmapPreview(send, evaluate, endX, endY, startX, startY);

  const erasedHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash !== drawnHash ? nextHash : undefined;
  }, "layer hash change after eraser");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const undoEraseHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after undo eraser");

  await evaluate(`
    (() => {
      document.querySelector('button[aria-label="Clear current layer"]').click();
      return true;
    })()
  `);

  const clearedHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash !== drawnHash ? nextHash : undefined;
  }, "layer hash change after clear");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const undoClearHash = await waitFor(async () => {
    const nextHash = await hashFile(layerPath);
    return nextHash === drawnHash ? nextHash : undefined;
  }, "layer hash restore after undo clear");

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      return true;
    })()
  `);

  await waitFor(
    () =>
      evaluate(`
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
            toggleRight: Boolean(panelRect && toggleRect && toggleRect.left >= panelRect.right - 1),
            toggleBottomAligned: Boolean(stageRect && toggleRect && Math.abs(toggleRect.bottom - stageRect.bottom) <= 1),
            toggleVertical: Boolean(toggleRect && toggleRect.height > toggleRect.width),
            footerCompact: Boolean(footerButtonRect && footerButtonRect.height <= 20),
            noBlendSelect: !firstShot.querySelector('select[aria-label="Layer blend mode"]'),
            noOpacitySlider: !firstShot.querySelector('input[aria-label="Active layer opacity"]'),
            hasBlendDot: Boolean(firstShot.querySelector('button[aria-label="Layer blend mode: normal"]')),
            toggleEmpty: toggle?.textContent.trim() === ""
          };
          if (!Object.values(checks).every(Boolean)) {
            throw new Error(JSON.stringify(checks));
          }
          return true;
        })()
      `),
    "inline shot layer panel delete button"
  );

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
  const paintBlankHash = await hashFile(paintLayerPath);

  await evaluate(`
    (() => {
      document.querySelector('[data-shot-id] button[aria-label="Toggle shot layers"]').click();
      document.querySelector('button[aria-label="Brush"]').click();
      return true;
    })()
  `);
  await dragStroke(send, startX, startY, endX, endY);

  const paintDrawnHash = await waitFor(async () => {
    const nextHash = await hashFile(paintLayerPath);
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
    const nextHash = await hashFile(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after eraser");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoEraseHash = await waitFor(async () => {
    const nextHash = await hashFile(paintLayerPath);
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
    const nextHash = await hashFile(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after lasso move");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoLassoMoveHash = await waitFor(async () => {
    const nextHash = await hashFile(paintLayerPath);
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
    const nextHash = await hashFile(paintLayerPath);
    return nextHash !== paintDrawnHash ? nextHash : undefined;
  }, "paint layer hash change after rectangle scale");

  await waitForUndoReady();
  await dispatchKeyZ(send, 4);

  const paintUndoRectangleScaleHash = await waitFor(async () => {
    const nextHash = await hashFile(paintLayerPath);
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
    (await hashFile(secondShotLayerPath)) !== secondShotBeforeHash ||
    (await hashFile(thirdShotLayerPath)) !== thirdShotBeforeHash
  ) {
    throw new Error("Drawing on the selected shot changed a neighboring shot layer");
  }

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

  const animationChecks = await evaluate(`
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

      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
      await delay(250);
      const selectedAfterRight = document.querySelector(".timeline-shot.is-selected span")?.textContent;
      const ghostCountAfterRight = document.querySelectorAll(".onion-skin-ghost").length;

      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", bubbles: true }));
      await delay(250);
      const selectedAfterLeft = document.querySelector(".timeline-shot.is-selected span")?.textContent;
      const ghostCountAfterLeft = document.querySelectorAll(".onion-skin-ghost").length;
      const timelineRect = document.querySelector(".timeline").getBoundingClientRect();

      return {
        onionToggleHiddenBeforeAnimation,
        aspectRatios,
        ghostInfoBefore,
        selectedAfterRight,
        ghostCountAfterRight,
        selectedAfterLeft,
        ghostCountAfterLeft,
        timelineVisible: timelineRect.height > 0 && timelineRect.bottom <= window.innerHeight
      };
    })()
  `);

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
    !animationChecks.timelineVisible
  ) {
    throw new Error(`Animation/onion skin check failed: ${JSON.stringify(animationChecks)}`);
  }

  const addShotUiCount = await evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const beforeCount = document.querySelectorAll("[data-shot-id]").length;
      const addShotButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent.trim() === "Add Shot");
      addShotButton.click();

      for (let index = 0; index < 30 && document.querySelectorAll("[data-shot-id]").length !== beforeCount + 1; index += 1) {
        await delay(100);
      }

      return document.querySelectorAll("[data-shot-id]").length;
    })()
  `);
  if (addShotUiCount !== 4) {
    throw new Error(`Add Shot did not update the storyboard UI: ${addShotUiCount}`);
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
        paintLayerDragPreviewVisible,
        sketchSettingsOpensOnStage,
        sketchSettingsIgnoredOutsideStage,
        layerToggleClickClosedPanel,
        layerToggleBottomStableAfterClose,
        layerRowsKeepFixedHeight,
        paintOrderBeforeDrag,
        paintOrderAfterDrag,
        paintOrderAfterBottomBlankDrag,
        saveConflictBlocked,
        firstSavedTopLeftRgb,
        archivedShotAHash,
        savedFileNames: savedTiffFiles,
        savedSwbStatuses: savedProject.shots.map((shot) => shot.swb.status),
        reopenedLayerIds,
        reopenedPaintHash,
        animationChecks,
        addShotUiCount,
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
  await rm(legacyRoot, { recursive: true, force: true });
}
