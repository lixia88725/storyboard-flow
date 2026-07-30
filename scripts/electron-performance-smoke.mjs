import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  constants,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runRoot = path.join("/private/tmp", `storyboard-flow-performance-${Date.now()}`);
const syntheticRoot = path.join(runRoot, "synthetic-250");
const requestedSyntheticLayerCount = Number.parseInt(
  process.env.STORYBOARD_PERF_LAYER_COUNT ?? "3",
  10
);
const syntheticLayerCount = Number.isFinite(requestedSyntheticLayerCount)
  ? Math.max(2, requestedSyntheticLayerCount)
  : 3;
const syntheticMultilayerRoot = path.join(
  runRoot,
  `synthetic-130-${syntheticLayerCount}-layers`
);
const requestedFixturePath = process.env.STORYBOARD_PERF_FIXTURE;
const onlyRequestedFixture = process.env.STORYBOARD_PERF_ONLY_FIXTURE === "1";
const includeMultilayerFixture = process.env.STORYBOARD_PERF_SKIP_MULTILAYER !== "1";
const port = String(9700 + Math.floor(Math.random() * 200));
const electronBin = createRequire(import.meta.url)("electron");
const performanceLimits = {
  rafP95Ms: 33,
  longPauseMs: 100,
  firstInkMs: 50,
  heapGrowthRatio: 1.25,
  maxEditors: {
    storyboard: 48,
    japaneseStoryboard: 12
  },
  maxEditorMountsPerFrame: 48,
  maxMarqueeActiveLayouts: 2,
  maxMarqueeTierChangesPerFrame: 6,
  minDenseMarqueeShots: 20
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (action, label, timeoutMs = 30000) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action();
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

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const pixelFingerprint = async (filePath) => {
  const { data, info } = await sharp(filePath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  hash.update(`${info.width}x${info.height}:${info.channels}:`);
  hash.update(data);
  return hash.digest("hex");
};

const copyOnWrite = async (sourcePath, targetPath) => {
  await copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE);
};

const createSyntheticWorkspace = async ({
  folderPath,
  shotCount = 250,
  layerCount = 1,
  projectName
}) => {
  const metadataRoot = path.join(folderPath, ".storyboard-workbench");
  const fixtureRoot = path.join(metadataRoot, "performance-fixture");
  const sourcePngPath = path.join(fixtureRoot, "source.png");
  const sourceTiffPath = path.join(fixtureRoot, "source.tiff");
  await mkdir(fixtureRoot, { recursive: true });

  const source = sharp({
    create: {
      width: 1998,
      height: 1080,
      channels: 4,
      background: { r: 232, g: 236, b: 242, alpha: 1 }
    }
  });
  await source.clone().png().toFile(sourcePngPath);
  await source.clone().tiff({ compression: "lzw" }).toFile(sourceTiffPath);
  const baseFingerprint = await pixelFingerprint(sourceTiffPath);
  const shots = [];

  for (let index = 0; index < shotCount; index += 1) {
    const shotNumber = String(index + 1).padStart(4, "0");
    const shotId = `performance-shot-${shotNumber}`;
    const fileName = `performance_scene_artist_v001_${shotNumber}.tiff`;
    const imagePath = path.join(folderPath, fileName);
    const bitmapPath = path.join(
      ".storyboard-workbench",
      "layers",
      shotId,
      "layer-image.png"
    );
    const absoluteBitmapPath = path.join(folderPath, bitmapPath);
    await mkdir(path.dirname(absoluteBitmapPath), { recursive: true });
    const paintLayers = Array.from(
      { length: Math.max(0, layerCount - 1) },
      (_item, layerIndex) => {
        const layerNumber = layerIndex + 1;
        const layerId = `layer-paint-${String(layerNumber).padStart(2, "0")}`;
        const paintBitmapPath = path.join(
          ".storyboard-workbench",
          "layers",
          shotId,
          `${layerId}.png`
        );
        return {
          id: layerId,
          kind: "paint",
          name: `Paint ${layerNumber}`,
          visible: true,
          locked: false,
          opacity: 0.12,
          blendMode: "normal",
          order: layerNumber,
          bitmapPath: paintBitmapPath,
          width: 1998,
          height: 1080
        };
      }
    );
    await Promise.all([
      copyOnWrite(sourceTiffPath, imagePath),
      copyOnWrite(sourcePngPath, absoluteBitmapPath),
      ...paintLayers.map((layer) =>
        copyOnWrite(sourcePngPath, path.join(folderPath, layer.bitmapPath))
      )
    ]);

    shots.push({
      id: shotId,
      imagePath,
      previewPath: absoluteBitmapPath,
      fileName,
      sourceFileName: fileName,
      order: index,
      sketchLayers: [],
      activeLayerTarget: "image",
      activeLayerId: "layer-image",
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
          bitmapPath,
          width: 1998,
          height: 1080
        },
        ...paintLayers
      ],
      swb: {
        version: 1,
        status: "owned",
        canvasWidth: 1998,
        canvasHeight: 1080,
        baseFingerprint,
        sourcePath: imagePath
      }
    });
  }

  const now = new Date().toISOString();
  await writeFile(
    path.join(metadataRoot, "storyboard.project.json"),
    JSON.stringify(
      {
        id: `performance-project-${shotCount}-${layerCount}`,
        name: projectName ?? `Performance ${shotCount} × ${layerCount} layers`,
        naming: {
          sceneCode: "performance",
          artistName: "artist",
          version: "v001"
        },
        shots,
        parkedShots: [],
        dialogues: [],
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    )
  );

  return { folderPath, shotCount };
};

const replacePathPrefix = (value, sourceRoot, cloneRoot) => {
  if (typeof value === "string") {
    return value.startsWith(sourceRoot)
      ? `${cloneRoot}${value.slice(sourceRoot.length)}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePathPrefix(item, sourceRoot, cloneRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replacePathPrefix(item, sourceRoot, cloneRoot)
      ])
    );
  }
  return value;
};

const cloneFixtureWorkspace = async (sourceRoot) => {
  const cloneRoot = path.join(runRoot, `fixture-${path.basename(sourceRoot)}`);
  await execFileAsync("/bin/cp", ["-cR", sourceRoot, cloneRoot]);
  const metadataPath = path.join(
    cloneRoot,
    ".storyboard-workbench",
    "storyboard.project.json"
  );
  const project = JSON.parse(await readFile(metadataPath, "utf8"));
  const rewrittenProject = replacePathPrefix(project, sourceRoot, cloneRoot);
  await writeFile(metadataPath, JSON.stringify(rewrittenProject, null, 2));
  return {
    folderPath: cloneRoot,
    shotCount: rewrittenProject.shots.length,
    sourceRoot
  };
};

const connectToStoryboardPage = async () => {
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    return pages.find(
      (item) => item.title === "Storyboard Flow" && item.webSocketDebuggerUrl
    );
  }, "Electron DevTools page");

  const websocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    websocket.addEventListener("open", resolve, { once: true });
    websocket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message));
    } else {
      request.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      websocket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Renderer evaluation failed"
      );
    }
    return result.result.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("HeapProfiler.enable");
  await send("Performance.enable");
  await send("Input.setIgnoreInputEvents", { ignore: false });
  return { evaluate, send, websocket };
};

const openFolder = async (evaluate, folderPath, expectedShotCount) => {
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('input[aria-label="Folder path"]'))`),
    "folder path input"
  );
  await evaluate(`
    (() => {
      const input = document.querySelector('input[aria-label="Folder path"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(folderPath)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `);
  await evaluate(`
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        document
          .querySelector('input[aria-label="Folder path"]')
          .closest("form")
          .requestSubmit();
        resolve(true);
      });
    })
  `);
  await waitFor(
    () =>
      evaluate(
        `document.querySelectorAll("[data-shot-id][data-media-tier]").length === ${expectedShotCount}`
      ),
    `${expectedShotCount} storyboard media shells`,
    180000
  );
};

const setZoomToFiftyPercent = async (evaluate) => {
  await evaluate(`
    (() => {
      const input = document.querySelector('.bottom-bar input[type="range"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "50");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`document.querySelector(".bottom-bar")?.textContent.includes("50%")`),
    "50% storyboard zoom"
  );
};

const showView = async (evaluate, view) => {
  const label =
    view === "storyboard"
      ? "Show storyboard board"
      : "Show Japanese storyboard sheet";
  const selector =
    view === "storyboard" ? ".board-grid" : ".japanese-storyboard-view";
  await evaluate(`
    (() => {
      document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)})?.click();
      return true;
    })()
  `);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    `${view} view`
  );
};

const summarizeRafDeltas = (deltas) => {
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: sorted.length,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    longPauses: sorted.filter((value) => value > performanceLimits.longPauseMs).length
  };
};

const scrollRounds = async (evaluate, rounds) =>
  evaluate(`
    (async () => {
      const root = document.querySelector(".workspace-board-scroll");
      if (!root || root.scrollHeight <= root.clientHeight) {
        throw new Error("Storyboard performance fixture is not scrollable");
      }
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const deltas = [];
      let maxEditorCount = 0;
      let maxHotCount = 0;
      let maxWarmCount = 0;
      let maxColdCount = 0;
      let editorMounts = 0;
      let editorUnmounts = 0;
      let pendingEditorMounts = 0;
      let maxEditorMountsPerFrame = 0;
      let lastFrame;
      let lastMountSample = 0;
      let monitoring = true;
      const stageCountInNodes = (nodes) => {
        let count = 0;
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".stage-overlay")) count += 1;
          count += node.querySelectorAll?.(".stage-overlay").length ?? 0;
        }
        return count;
      };
      const mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          const added = stageCountInNodes(record.addedNodes);
          const removed = stageCountInNodes(record.removedNodes);
          editorMounts += added;
          editorUnmounts += removed;
          pendingEditorMounts += added;
        }
      });
      mutationObserver.observe(root, { childList: true, subtree: true });
      const monitor = (now) => {
        if (lastFrame !== undefined) deltas.push(now - lastFrame);
        lastFrame = now;
        maxEditorMountsPerFrame = Math.max(
          maxEditorMountsPerFrame,
          pendingEditorMounts
        );
        pendingEditorMounts = 0;
        if (now - lastMountSample > 80) {
          maxEditorCount = Math.max(
            maxEditorCount,
            document.querySelectorAll(".stage-overlay").length
          );
          maxHotCount = Math.max(
            maxHotCount,
            document.querySelectorAll('[data-media-tier="hot"]').length
          );
          maxWarmCount = Math.max(
            maxWarmCount,
            document.querySelectorAll('[data-media-tier="warm"]').length
          );
          maxColdCount = Math.max(
            maxColdCount,
            document.querySelectorAll('[data-media-tier="cold"]').length
          );
          lastMountSample = now;
        }
        if (monitoring) requestAnimationFrame(monitor);
      };
      requestAnimationFrame(monitor);

      const animateTo = (target, duration = 850) =>
        new Promise((resolve) => {
          const start = root.scrollTop;
          const startedAt = performance.now();
          const step = (now) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            const eased = progress < 0.5
              ? 2 * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            root.scrollTop = start + (target - start) * eased;
            if (progress < 1) requestAnimationFrame(step);
            else requestAnimationFrame(() => resolve());
          };
          requestAnimationFrame(step);
        });

      for (let index = 0; index < ${rounds}; index += 1) {
        await animateTo(root.scrollHeight - root.clientHeight);
        await animateTo(0);
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      monitoring = false;
      mutationObserver.disconnect();
      const rootRect = root.getBoundingClientRect();
      const visibleWithoutEditor = Array.from(
        root.querySelectorAll("[data-shot-id][data-media-tier]")
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.bottom > rootRect.top &&
          rect.top < rootRect.bottom &&
          rect.right > rootRect.left &&
          rect.left < rootRect.right &&
          !element.querySelector(".stage-overlay")
        );
      }).length;
      const visibleUnreadyLayerImages = Array.from(
        root.querySelectorAll("[data-shot-id][data-media-tier]")
      ).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.bottom <= rootRect.top ||
          rect.top >= rootRect.bottom ||
          rect.right <= rootRect.left ||
          rect.left >= rootRect.right
        ) {
          return [];
        }
        return Array.from(element.querySelectorAll(".image-stage img")).filter(
          (image) => !image.complete || image.naturalWidth === 0
        );
      }).length;
      return {
        deltas,
        maxEditorCount,
        maxHotCount,
        maxWarmCount,
        maxColdCount,
        editorMounts,
        editorUnmounts,
        maxEditorMountsPerFrame,
        visibleWithoutEditor,
        visibleUnreadyLayerImages,
        mountedEditors: document.querySelectorAll(".stage-overlay").length,
        staticMedia: document.querySelectorAll(".is-static-shot-media").length,
        mediaTiers: {
          hot: document.querySelectorAll('[data-media-tier="hot"]').length,
          warm: document.querySelectorAll('[data-media-tier="warm"]').length,
          cold: document.querySelectorAll('[data-media-tier="cold"]').length
        }
      };
    })()
  `);

const collectHeap = async (send) => {
  await send("HeapProfiler.collectGarbage");
  const usage = await send("Runtime.getHeapUsage");
  return usage.usedSize;
};

const startRafMonitor = (evaluate) =>
  evaluate(`
    (() => {
      if (window.__storyboardPerformanceRaf) {
        cancelAnimationFrame(window.__storyboardPerformanceRaf.frame);
      }
      const state = { deltas: [], last: undefined, active: true, frame: 0 };
      const tick = (now) => {
        if (state.last !== undefined) state.deltas.push(now - state.last);
        state.last = now;
        if (state.active) state.frame = requestAnimationFrame(tick);
      };
      state.frame = requestAnimationFrame(tick);
      window.__storyboardPerformanceRaf = state;
      return true;
    })()
  `);

const stopRafMonitor = (evaluate) =>
  evaluate(`
    (async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const state = window.__storyboardPerformanceRaf;
      state.active = false;
      cancelAnimationFrame(state.frame);
      return state.deltas;
    })()
  `);

const clickAt = async (send, point, modifiers = 0) => {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers
  });
};

const visibleSelectionTargets = (evaluate, view) =>
  evaluate(`
    (() => {
      const rootRect = document.querySelector(".workspace-board-scroll").getBoundingClientRect();
      const selector = ${
        view === "storyboard"
          ? JSON.stringify(".shot-card .shot-head")
          : JSON.stringify(".japanese-storyboard-cut")
      };
      return Array.from(document.querySelectorAll(selector))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            shotId: element.closest("[data-shot-id]")?.dataset.shotId,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            visible:
              rect.bottom > rootRect.top &&
              rect.top < rootRect.bottom &&
              rect.right > rootRect.left &&
              rect.left < rootRect.right
          };
        })
        .filter((item) => item.visible)
        .slice(0, 12);
    })()
  `);

const measureMultiSelect = async (evaluate, send, view) => {
  const targets = await visibleSelectionTargets(evaluate, view);
  assert(targets.length >= 3, `${view} view did not expose enough selection targets`);
  await startRafMonitor(evaluate);
  await evaluate(`
    (() => {
      const rootRect = document.querySelector(".workspace-board-scroll").getBoundingClientRect();
      const selector = ${
        view === "storyboard"
          ? JSON.stringify(".shot-card .shot-head")
          : JSON.stringify(".japanese-storyboard-cut")
      };
      const elements = Array.from(document.querySelectorAll(selector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
        })
        .slice(0, ${targets.length});
      elements[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (const element of elements.slice(1)) {
        element.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            metaKey: true,
            ctrlKey: true
          })
        );
      }
      return elements.length;
    })()
  `);
  const deltas = await stopRafMonitor(evaluate);
  const selectedCount = await evaluate(
    view === "storyboard"
      ? `document.querySelectorAll(".shot-card.is-selected").length`
      : `document.querySelectorAll(".japanese-storyboard-row.is-selected").length`
  );
  assert(selectedCount >= 3, `${view} multi-select did not select multiple shots`);
  return summarizeRafDeltas(deltas);
};

const marqueeDragPoints = (evaluate, view) =>
  evaluate(`
    (() => {
      const root = document.querySelector(".workspace-board-scroll");
      root.scrollTop = 0;
      const rootRect = document.querySelector(".workspace-board-scroll").getBoundingClientRect();
      const shotSelector = ${
        view === "storyboard"
          ? JSON.stringify(".shot-card")
          : JSON.stringify(".japanese-storyboard-row")
      };
      const shots = Array.from(document.querySelectorAll(shotSelector))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.bottom > rootRect.top && rect.top < rootRect.bottom);
      const scopeSelector = ${
        view === "storyboard"
          ? JSON.stringify(".board-grid")
          : JSON.stringify(".japanese-storyboard-view")
      };
      const scope = document.querySelector(scopeSelector);
      if (!scope || shots.length < 2) return undefined;
      return {
        scopeSelector,
        start: {
          x: Math.round(Math.max(rootRect.left + 3, shots[0].left + 3)),
          y: Math.round(Math.max(rootRect.top + 68, shots[0].top + 3))
        },
        denseEnd: {
          x: Math.round(rootRect.right - 4),
          y: Math.round(Math.max(rootRect.top + 68, rootRect.bottom - 80))
        },
        end: {
          x: Math.round(rootRect.right - 4),
          y: Math.round(rootRect.bottom - 4)
        }
      };
    })()
  `);

const readPerformanceMetrics = async (send) => {
  const result = await send("Performance.getMetrics");
  return Object.fromEntries(
    result.metrics.map(({ name, value }) => [name, value])
  );
};

const metricDelta = (before, after, name) =>
  (after[name] ?? 0) - (before[name] ?? 0);

const measureMarquee = async (evaluate, send, view) => {
  const edgeFrameCount = view === "storyboard" ? 36 : 72;
  const targets = await visibleSelectionTargets(evaluate, view);
  await clickAt(send, targets[0]);
  const points = await marqueeDragPoints(evaluate, view);
  assert(points, `${view} view did not expose a marquee background point`);
  await evaluate(`
    (() => {
      const root = document.querySelector(".workspace-board-scroll");
      const stageCountInNodes = (nodes) => {
        let count = 0;
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".stage-overlay")) count += 1;
          count += node.querySelectorAll?.(".stage-overlay").length ?? 0;
        }
        return count;
      };
      const state = {
        phase: "active",
        active: {
          deltas: [],
          lastFrame: undefined,
          editorMounts: 0,
          editorUnmounts: 0,
          pendingTierChanges: 0,
          maxTierChangesPerFrame: 0
        },
        edge: {
          deltas: [],
          lastFrame: undefined,
          editorMounts: 0,
          editorUnmounts: 0,
          pendingTierChanges: 0,
          maxTierChangesPerFrame: 0
        },
        release: {
          deltas: [],
          lastFrame: undefined,
          editorMounts: 0,
          editorUnmounts: 0,
          pendingTierChanges: 0,
          maxTierChangesPerFrame: 0
        },
        monitoring: true,
        uniqueSelectedCounts: [],
        frame: 0
      };
      const observer = new MutationObserver((records) => {
        const phase = state[state.phase];
        for (const record of records) {
          if (record.type === "attributes") {
            phase.pendingTierChanges += 1;
          } else {
            phase.editorMounts += stageCountInNodes(record.addedNodes);
            phase.editorUnmounts += stageCountInNodes(record.removedNodes);
          }
        }
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["data-media-tier"],
        childList: true,
        subtree: true
      });
      const monitor = (now) => {
        const phase = state[state.phase];
        if (phase.lastFrame !== undefined) {
          phase.deltas.push(now - phase.lastFrame);
        }
        phase.lastFrame = now;
        phase.maxTierChangesPerFrame = Math.max(
          phase.maxTierChangesPerFrame,
          phase.pendingTierChanges
        );
        phase.pendingTierChanges = 0;
        const label = document.querySelector(".selected-count")?.textContent ?? "";
        const selectedCount = Number.parseInt(label, 10);
        if (Number.isFinite(selectedCount)) {
          state.uniqueSelectedCounts.push(selectedCount);
        }
        if (state.monitoring) {
          state.frame = requestAnimationFrame(monitor);
        }
      };
      state.frame = requestAnimationFrame(monitor);
      state.observer = observer;
      window.__storyboardMarqueePerformance = state;
      const scope = document.querySelector(${JSON.stringify(
        view === "storyboard" ? ".board-grid" : ".japanese-storyboard-view"
      )});
      scope.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: ${points.start.x},
          clientY: ${points.start.y},
          pointerId: 999,
          pointerType: "mouse",
          isPrimary: true
        })
      );
      return true;
    })()
  `);
  const activeMetricsBefore = await readPerformanceMetrics(send);
  await evaluate(`
    (async () => {
      for (let index = 1; index <= 16; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientX: Math.round(
              ${points.start.x} + ((${points.denseEnd.x} - ${points.start.x}) * index) / 16
            ),
            clientY: Math.round(
              ${points.start.y} + ((${points.denseEnd.y} - ${points.start.y}) * index) / 16
            ),
            pointerId: 999,
            pointerType: "mouse",
              isPrimary: true
            })
        );
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return true;
    })()
  `);
  const activeMetricsAfter = await readPerformanceMetrics(send);
  await evaluate(
    `window.__storyboardMarqueePerformance.phase = "edge"; true`
  );
  const edgeMetricsBefore = await readPerformanceMetrics(send);
  await evaluate(`
    (async () => {
      for (let index = 1; index <= ${edgeFrameCount}; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientX: ${points.end.x},
            clientY: ${points.end.y},
            pointerId: 999,
            pointerType: "mouse",
            isPrimary: true
          })
        );
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return true;
    })()
  `);
  const edgeMetricsAfter = await readPerformanceMetrics(send);
  await evaluate(`
    (() => {
      window.__storyboardMarqueePerformance.phase = "release";
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: ${points.end.x},
          clientY: ${points.end.y},
          pointerId: 999,
          pointerType: "mouse",
          isPrimary: true
        })
      );
      return true;
    })()
  `);
  const releaseMetricsBefore = await readPerformanceMetrics(send);
  await evaluate(`
    new Promise((resolve) => {
      let remainingFrames = 20;
      const waitFrame = () => {
        remainingFrames -= 1;
        if (remainingFrames <= 0) resolve(true);
        else requestAnimationFrame(waitFrame);
      };
      requestAnimationFrame(waitFrame);
    })
  `);
  const releaseMetricsAfter = await readPerformanceMetrics(send);
  const probe = await evaluate(`
    (() => {
      const state = window.__storyboardMarqueePerformance;
      state.monitoring = false;
      cancelAnimationFrame(state.frame);
      state.observer.disconnect();
      return {
        active: state.active,
        edge: state.edge,
        release: state.release,
        maxSelectedCount: Math.max(0, ...state.uniqueSelectedCounts),
        finalSelectedCount:
          document.querySelectorAll(${
            view === "storyboard"
              ? JSON.stringify(".shot-card.is-selected")
              : JSON.stringify(".japanese-storyboard-row.is-selected")
          }).length
      };
    })()
  `);
  return {
    activeRaf: summarizeRafDeltas(probe.active.deltas),
    edgeRaf: summarizeRafDeltas(probe.edge.deltas),
    releaseRaf: summarizeRafDeltas(probe.release.deltas),
    active: {
      editorMounts: probe.active.editorMounts,
      editorUnmounts: probe.active.editorUnmounts,
      maxTierChangesPerFrame: probe.active.maxTierChangesPerFrame,
      layoutCount: metricDelta(
        activeMetricsBefore,
        activeMetricsAfter,
        "LayoutCount"
      ),
      recalcStyleCount: metricDelta(
        activeMetricsBefore,
        activeMetricsAfter,
        "RecalcStyleCount"
      )
    },
    edge: {
      editorMounts: probe.edge.editorMounts,
      editorUnmounts: probe.edge.editorUnmounts,
      maxTierChangesPerFrame: probe.edge.maxTierChangesPerFrame,
      layoutCount: metricDelta(
        edgeMetricsBefore,
        edgeMetricsAfter,
        "LayoutCount"
      ),
      recalcStyleCount: metricDelta(
        edgeMetricsBefore,
        edgeMetricsAfter,
        "RecalcStyleCount"
      )
    },
    release: {
      editorMounts: probe.release.editorMounts,
      editorUnmounts: probe.release.editorUnmounts,
      maxTierChangesPerFrame: probe.release.maxTierChangesPerFrame,
      layoutCount: metricDelta(
        releaseMetricsBefore,
        releaseMetricsAfter,
        "LayoutCount"
      ),
      recalcStyleCount: metricDelta(
        releaseMetricsBefore,
        releaseMetricsAfter,
        "RecalcStyleCount"
      )
    },
    maxSelectedCount: probe.maxSelectedCount,
    finalSelectedCount: probe.finalSelectedCount,
    edgeFrames: edgeFrameCount
  };
};

const prepareVisibleStage = (evaluate) =>
  evaluate(`
    (async () => {
      const rootRect = document.querySelector(".workspace-board-scroll").getBoundingClientRect();
      const stage = Array.from(document.querySelectorAll(".stage-overlay")).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 40 && rect.height > 40 && rect.bottom > rootRect.top && rect.top < rootRect.bottom;
      });
      if (!stage) return undefined;
      stage.scrollIntoView({ block: "nearest", inline: "center" });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const nextRootRect = document
        .querySelector(".workspace-board-scroll")
        .getBoundingClientRect();
      const rect = stage.getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, nextRootRect.left);
      const visibleRight = Math.min(rect.right, nextRootRect.right);
      const visibleTop = Math.max(rect.top, nextRootRect.top);
      const visibleBottom = Math.min(rect.bottom, nextRootRect.bottom);
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
        return undefined;
      }
      return {
        shotId: stage.closest("[data-shot-id]")?.dataset.shotId,
        x: Math.round((visibleLeft + visibleRight) * 0.5),
        y: Math.round((visibleTop + visibleBottom) * 0.5)
      };
    })()
  `);

const installFirstInkProbe = (evaluate) =>
  evaluate(`
    (() => {
      window.__storyboardFirstInk = new Promise((resolve) => {
        const timeout = window.setTimeout(
          () => resolve({ latencyMs: Infinity, reason: "timeout" }),
          1500
        );
        document.addEventListener(
          "pointerdown",
          (event) => {
            const imageStage = event.target.closest?.(".image-stage");
            const startedAt = performance.now();
            window.__storyboardFirstInkPointerId = event.pointerId;
            if (!imageStage) {
              clearTimeout(timeout);
              resolve({ latencyMs: Infinity, reason: "missing image stage" });
              return;
            }
            const sample = () => {
              const canvases = imageStage.querySelectorAll(".konvajs-content canvas");
              for (const canvas of canvases) {
                const rect = canvas.getBoundingClientRect();
                if (!rect.width || !rect.height) continue;
                const x = Math.max(
                  0,
                  Math.min(canvas.width - 1, Math.round((event.clientX - rect.left) * canvas.width / rect.width))
                );
                const y = Math.max(
                  0,
                  Math.min(canvas.height - 1, Math.round((event.clientY - rect.top) * canvas.height / rect.height))
                );
                const radius = Math.max(2, Math.round(canvas.width / rect.width * 6));
                const left = Math.max(0, x - radius);
                const top = Math.max(0, y - radius);
                const width = Math.min(canvas.width - left, radius * 2 + 1);
                const height = Math.min(canvas.height - top, radius * 2 + 1);
                const pixels = canvas.getContext("2d").getImageData(left, top, width, height).data;
                for (let index = 3; index < pixels.length; index += 4) {
                  if (pixels[index] > 0) {
                    clearTimeout(timeout);
                    resolve({ latencyMs: performance.now() - startedAt, reason: "visible" });
                    return;
                  }
                }
              }
              if (performance.now() - startedAt > 1400) {
                clearTimeout(timeout);
                resolve({ latencyMs: Infinity, reason: "no visible preview" });
                return;
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          },
          { capture: true, once: true }
        );
      });
      return true;
    })()
  `);

const measureFirstInk = async (evaluate, send, view) => {
  const target = await prepareVisibleStage(evaluate);
  assert(target?.shotId, `${view} view did not expose a visible stage for drawing`);
  await evaluate(`document.querySelector('button[aria-label="Brush"]')?.click()`);
  await waitFor(
    () => evaluate(`document.querySelector('button[aria-label="Brush"]')?.classList.contains("selected")`),
    "Brush tool selection"
  );
  await installFirstInkProbe(evaluate);
  await startRafMonitor(evaluate);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  const firstInk = await evaluate(`window.__storyboardFirstInk`);
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.x + 10,
    y: target.y + 4,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x + 10,
    y: target.y + 4,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
  await delay(250);
  const drawingRaf = summarizeRafDeltas(await stopRafMonitor(evaluate));
  return { ...firstInk, drawingRaf, targetShotId: target.shotId };
};

const rendererReadCount = (evaluate) =>
  evaluate(`window.storyboard.getRendererPerformanceCounters().readLayerPngCalls`);

const assertRafBudget = (summary, label) => {
  assert(
    summary.p95Ms <= performanceLimits.rafP95Ms,
    `${label} RAF p95 ${summary.p95Ms.toFixed(1)}ms exceeded ${performanceLimits.rafP95Ms}ms`
  );
  assert(
    summary.longPauses === 0,
    `${label} had ${summary.longPauses} pauses over ${performanceLimits.longPauseMs}ms (max ${summary.maxMs.toFixed(1)}ms)`
  );
};

const assertNoLongRafPause = (summary, label) => {
  assert(
    summary.longPauses === 0,
    `${label} had ${summary.longPauses} pauses over ${performanceLimits.longPauseMs}ms (max ${summary.maxMs.toFixed(1)}ms)`
  );
};

const measureView = async ({ evaluate, send, fixture, view }) => {
  await startRafMonitor(evaluate);
  await showView(evaluate, view);
  await setZoomToFiftyPercent(evaluate);
  const activationRaf = summarizeRafDeltas(await stopRafMonitor(evaluate));
  const readCountBeforePassiveWork = await rendererReadCount(evaluate);
  const firstScroll = await scrollRounds(evaluate, 1);
  const stableHeap = await collectHeap(send);
  const laterScroll = await scrollRounds(evaluate, 2);
  const finalHeap = await collectHeap(send);
  const scrollRaf = summarizeRafDeltas([
    ...firstScroll.deltas,
    ...laterScroll.deltas
  ]);
  const multiSelectRaf = await measureMultiSelect(evaluate, send, view);
  const marquee = await measureMarquee(evaluate, send, view);
  const readCountAfterPassiveWork = await rendererReadCount(evaluate);

  assert(
    readCountAfterPassiveWork === readCountBeforePassiveWork,
    `${fixture.name} ${view} passive open/scroll/selection issued ${
      readCountAfterPassiveWork - readCountBeforePassiveWork
    } readLayerPng calls`
  );
  const mountedEditors = Math.max(
    firstScroll.maxEditorCount,
    laterScroll.maxEditorCount,
    firstScroll.mountedEditors,
    laterScroll.mountedEditors
  );
  assert(mountedEditors > 0, `${fixture.name} ${view} mounted no SketchPad editors`);
  assert(
    mountedEditors < fixture.shotCount,
    `${fixture.name} ${view} kept all ${fixture.shotCount} SketchPad editors mounted`
  );
  assert(
    mountedEditors <= performanceLimits.maxEditors[view],
    `${fixture.name} ${view} mounted ${mountedEditors} editors, exceeding the ${
      performanceLimits.maxEditors[view]
    } editor budget`
  );
  const maxEditorMountsPerFrame = Math.max(
    firstScroll.maxEditorMountsPerFrame,
    laterScroll.maxEditorMountsPerFrame
  );
  assert(
    maxEditorMountsPerFrame <= performanceLimits.maxEditorMountsPerFrame,
    `${fixture.name} ${view} mounted ${maxEditorMountsPerFrame} editors in one frame`
  );
  assert(
    firstScroll.visibleWithoutEditor === 0 && laterScroll.visibleWithoutEditor === 0,
    `${fixture.name} ${view} left a visible shot without an editor after scrolling`
  );
  assert(
    firstScroll.visibleUnreadyLayerImages === 0 &&
      laterScroll.visibleUnreadyLayerImages === 0,
    `${fixture.name} ${view} left visible layer images undecoded after scrolling`
  );
  assert(
    laterScroll.staticMedia > 0,
    `${fixture.name} ${view} did not restore offscreen static media`
  );
  const heapGrowthRatio = stableHeap > 0 ? finalHeap / stableHeap : 1;
  assert(
    heapGrowthRatio <= performanceLimits.heapGrowthRatio,
    `${fixture.name} ${view} heap grew ${(heapGrowthRatio * 100).toFixed(1)}% of its first-round stable value`
  );
  assertRafBudget(scrollRaf, `${fixture.name} ${view} scroll`);
  assertNoLongRafPause(activationRaf, `${fixture.name} ${view} activate`);
  assertRafBudget(multiSelectRaf, `${fixture.name} ${view} multi-select`);
  assertRafBudget(
    marquee.activeRaf,
    `${fixture.name} ${view} marquee active drag`
  );
  assertRafBudget(
    marquee.edgeRaf,
    `${fixture.name} ${view} marquee edge scroll`
  );
  assertRafBudget(
    marquee.releaseRaf,
    `${fixture.name} ${view} marquee release reconcile`
  );
  assert(
    marquee.active.editorMounts === 0 &&
      marquee.active.editorUnmounts === 0,
    `${fixture.name} ${view} marquee active drag churned editors ` +
      `(${marquee.active.editorMounts} mounts, ${marquee.active.editorUnmounts} unmounts)`
  );
  assert(
    marquee.active.maxTierChangesPerFrame === 0,
    `${fixture.name} ${view} marquee active drag changed media tiers`
  );
  assert(
    marquee.edge.editorMounts === 0 &&
      marquee.edge.editorUnmounts === 0,
    `${fixture.name} ${view} marquee edge scroll churned editors ` +
      `(${marquee.edge.editorMounts} mounts, ${marquee.edge.editorUnmounts} unmounts)`
  );
  assert(
    marquee.edge.maxTierChangesPerFrame === 0,
    `${fixture.name} ${view} marquee edge scroll changed media tiers`
  );
  assert(
    marquee.active.layoutCount <= performanceLimits.maxMarqueeActiveLayouts,
    `${fixture.name} ${view} marquee active drag performed ${marquee.active.layoutCount} layouts`
  );
  assert(
    marquee.release.maxTierChangesPerFrame <=
      performanceLimits.maxMarqueeTierChangesPerFrame,
    `${fixture.name} ${view} marquee release changed ` +
      `${marquee.release.maxTierChangesPerFrame} media tiers in one frame`
  );
  assert(
    marquee.maxSelectedCount >= performanceLimits.minDenseMarqueeShots,
    `${fixture.name} ${view} dense marquee selected only ${marquee.maxSelectedCount} shots`
  );

  const readCountBeforeStroke = await rendererReadCount(evaluate);
  const firstInk = await measureFirstInk(evaluate, send, view);
  try {
    await waitFor(
      async () => (await rendererReadCount(evaluate)) >= readCountBeforeStroke + 1,
      `${fixture.name} ${view} single layer read after stroke`
    );
  } catch (error) {
    const drawingDiagnostics = await evaluate(`
      (() => {
        const shot = document.querySelector(
          \`[data-shot-id="\${CSS.escape(${JSON.stringify(
            firstInk.targetShotId
          )})}"]\`
        );
        return {
          selectedLabel: document.querySelector(".selected-count")?.textContent,
          brushSelected: document
            .querySelector('button[aria-label="Brush"]')
            ?.classList.contains("selected"),
          marqueeActive: document
            .querySelector(".selection-marquee")
            ?.classList.contains("is-active"),
          targetConnected: Boolean(shot?.isConnected),
          targetMediaTier: shot?.dataset.mediaTier,
          targetStageCount: shot?.querySelectorAll(".stage-overlay").length ?? 0,
          allStageCount: document.querySelectorAll(".stage-overlay").length
        };
      })()
    `);
    throw new Error(
      `${error.message}; firstInk=${JSON.stringify(firstInk)}; ` +
        `diagnostics=${JSON.stringify(drawingDiagnostics)}`
    );
  }
  const readCountAfterStroke = await rendererReadCount(evaluate);
  assert(
    readCountAfterStroke === readCountBeforeStroke + 1,
    `${fixture.name} ${view} stroke read the current layer more than once`
  );
  assert(
    Number.isFinite(firstInk.latencyMs) &&
      firstInk.latencyMs <= performanceLimits.firstInkMs,
    `${fixture.name} ${view} first ink ${firstInk.latencyMs}ms exceeded ${performanceLimits.firstInkMs}ms (${firstInk.reason})`
  );
  assertRafBudget(firstInk.drawingRaf, `${fixture.name} ${view} drawing`);

  return {
    view,
    shots: fixture.shotCount,
    mountedEditors,
    staticMedia: laterScroll.staticMedia,
    mediaTiers: laterScroll.mediaTiers,
    editorChurn: {
      mounts: firstScroll.editorMounts + laterScroll.editorMounts,
      unmounts: firstScroll.editorUnmounts + laterScroll.editorUnmounts,
      maxMountsPerFrame: maxEditorMountsPerFrame
    },
    passiveLayerPngReads: readCountAfterPassiveWork - readCountBeforePassiveWork,
    strokeLayerPngReads: readCountAfterStroke - readCountBeforeStroke,
    firstInkMs: Number(firstInk.latencyMs.toFixed(2)),
    heapGrowthPercent: Number(((heapGrowthRatio - 1) * 100).toFixed(2)),
    raf: {
      activate: activationRaf,
      scroll: scrollRaf,
      multiSelect: multiSelectRaf,
      marquee,
      drawing: firstInk.drawingRaf
    }
  };
};

let electronProcess;
let websocket;

try {
  await mkdir(runRoot, { recursive: true });
  const fixtures = [];
  if (!onlyRequestedFixture) {
    fixtures.push({
      name: "synthetic-250",
      ...(await createSyntheticWorkspace({
        folderPath: syntheticRoot,
        shotCount: 250,
        layerCount: 1,
        projectName: "Performance 250"
      }))
    });
    if (includeMultilayerFixture) {
      fixtures.push({
        name: `synthetic-130-${syntheticLayerCount}-layers`,
        ...(await createSyntheticWorkspace({
          folderPath: syntheticMultilayerRoot,
          shotCount: 130,
          layerCount: syntheticLayerCount
        }))
      });
    }
  }
  if (requestedFixturePath) {
    fixtures.push({
      name: path.basename(requestedFixturePath),
      ...(await cloneFixtureWorkspace(path.resolve(requestedFixturePath)))
    });
  }
  assert(fixtures.length > 0, "No performance fixture was configured");

  const userDataRoot = path.join(runRoot, "electron-user-data");
  await mkdir(userDataRoot, { recursive: true });
  electronProcess = spawn(electronBin, [`--remote-debugging-port=${port}`, "."], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SWB_USER_DATA_DIR: userDataRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  electronProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  electronProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const connection = await connectToStoryboardPage();
  websocket = connection.websocket;
  const results = [];
  for (const fixture of fixtures) {
    await openFolder(connection.evaluate, fixture.folderPath, fixture.shotCount);
    for (const view of ["storyboard", "japaneseStoryboard"]) {
      results.push(
        await measureView({
          evaluate: connection.evaluate,
          send: connection.send,
          fixture,
          view
        })
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        limits: performanceLimits,
        fixtures: fixtures.map(({ name, folderPath, shotCount, sourceRoot }) => ({
          name,
          folderPath,
          shotCount,
          sourceRoot
        })),
        results
      },
      null,
      2
    )
  );
  console.log("Storyboard Flow performance smoke passed");
} finally {
  websocket?.close();
  if (electronProcess && electronProcess.exitCode === null) {
    const exited = new Promise((resolve) => electronProcess.once("exit", resolve));
    electronProcess.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
    if (electronProcess.exitCode === null) {
      electronProcess.kill("SIGKILL");
      await Promise.race([exited, delay(3000)]);
    }
  }
  let cleanupError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(runRoot, { recursive: true, force: true });
      cleanupError = undefined;
      break;
    } catch (error) {
      cleanupError = error;
      await delay(200);
    }
  }
  if (cleanupError) {
    console.warn(`Performance smoke cleanup warning: ${cleanupError.message}`);
  }
}
