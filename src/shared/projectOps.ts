import type {
  BitmapLayer,
  Dialogue,
  ImportedImage,
  Project,
  ProjectNaming,
  RenamePlanItem,
  RenamePreflightResult,
  Shot,
  ShotMatte,
  ShotSwbState,
  SketchLayer,
  SketchStroke
} from "./types";
import { isStandaloneLayeredTiffSnapshot } from "../../electron/shared/standaloneLayeredInput";

export type ShotPlacement = "before" | "after";
export type StoryboardDirection = "left" | "right" | "up" | "down";
export type RenamePlanOptions = {
  allowDefaultNamingFields?: boolean;
};
export const sketchBlendModes = ["normal", "multiply", "screen"] as const;
export const bitmapBlendModes = ["normal", "multiply", "screen"] as const;

const now = () => new Date().toISOString();
export const defaultProjectNaming: ProjectNaming = {
  sceneCode: "",
  artistName: "",
  version: ""
};
export const defaultSaveNaming: ProjectNaming = {
  sceneCode: "scene",
  artistName: "artist",
  version: "v001"
};
export const swbFormatVersion = 1;
export const defaultSketchLayerName = "Drawing";
export const imageBitmapLayerId = "layer-image";
export const imageBitmapLayerName = "Image";
export const matteOverlayBitmapLayerId = "layer-matte-overlay";
export const matteOverlayBitmapLayerName = "Matte Overlay";
export const dialogueOverlayBitmapLayerId = "layer-dialogue-overlay";
export const dialogueOverlayBitmapLayerName = "Dialogue Overlay";
export const defaultShotMatteBarHeight = 75;

export const createProject = (name = "Untitled Storyboard"): Project => {
  const timestamp = now();

  return {
    id: crypto.randomUUID(),
    name,
    naming: { ...defaultProjectNaming },
    shots: [],
    dialogues: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

export const sortedShots = (shots: Shot[]): Shot[] => {
  return [...shots].sort((a, b) => a.order - b.order);
};

export const getNextStoryboardIndex = (
  currentIndex: number,
  totalCount: number,
  columnCount: number,
  direction: StoryboardDirection,
  linearMode = false
): number => {
  if (totalCount <= 0) {
    return -1;
  }

  const safeCurrentIndex =
    currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex, 0), totalCount - 1);

  if (linearMode) {
    if (direction === "right") {
      return Math.min(safeCurrentIndex + 1, totalCount - 1);
    }

    if (direction === "left") {
      return Math.max(safeCurrentIndex - 1, 0);
    }

    return safeCurrentIndex;
  }

  const safeColumnCount = Math.max(1, columnCount);
  const currentColumn = safeCurrentIndex % safeColumnCount;

  if (direction === "left") {
    return currentColumn === 0 ? safeCurrentIndex : safeCurrentIndex - 1;
  }

  if (direction === "right") {
    const nextIndex = safeCurrentIndex + 1;
    return currentColumn === safeColumnCount - 1 || nextIndex >= totalCount
      ? safeCurrentIndex
      : nextIndex;
  }

  if (direction === "up") {
    return safeCurrentIndex - safeColumnCount < 0
      ? safeCurrentIndex
      : safeCurrentIndex - safeColumnCount;
  }

  const nextIndex = safeCurrentIndex + safeColumnCount;
  return nextIndex >= totalCount ? safeCurrentIndex : nextIndex;
};

export const dialoguesForShot = (project: Project, shotId: string): Dialogue[] => {
  return project.dialogues
    .filter((dialogue) => dialogue.shotId === shotId)
    .sort((a, b) => a.order - b.order);
};

export const matteForShot = (shot: Shot): ShotMatte | undefined => shot.presentation?.matte;

export const sceneMatteModeForProject = (
  project: Project
): ShotMatte["mode"] | undefined => {
  const modes = new Set(
    project.shots
      .map((shot) => matteForShot(shot)?.mode)
      .filter((mode): mode is ShotMatte["mode"] => Boolean(mode))
  );
  return modes.size === 1
    ? [...modes][0]
    : undefined;
};

export const sceneDialogueOverlayEnabledForProject = (project: Project): boolean =>
  project.shots.length > 0 &&
  project.shots.every((shot) =>
    bitmapLayersForShot(shot).some(
      (layer) => layer.id === dialogueOverlayBitmapLayerId
    )
  );

const applyMatteToShot = (
  shot: Shot,
  mode: ShotMatte["mode"],
  normalizedBarHeight: number
): Shot => {
  const existingMatte = matteForShot(shot);
  if (existingMatte && existingMatte.mode !== mode) {
    return shot;
  }

  const layers = bitmapLayersForShot(shot);
  const sourceHeight =
    shot.swb?.canvasHeight ??
    Math.max(0, ...layers.map((layer) => layer.height));
  const canvasWidth =
    shot.swb?.canvasWidth ??
    Math.max(0, ...layers.map((layer) => layer.width));
  if (sourceHeight <= 0 || canvasWidth <= 0) {
    return shot;
  }

  const existingOverlay = layers.find((layer) => layer.id === matteOverlayBitmapLayerId);
  if (
    existingMatte &&
    existingOverlay?.width === canvasWidth &&
    existingOverlay.height === sourceHeight &&
    existingOverlay.visible &&
    existingOverlay.locked &&
    existingOverlay.opacity === 1 &&
    existingOverlay.blendMode === "normal"
  ) {
    return shot;
  }

  const shouldExpand = mode === "expanded" && !existingMatte;
  const canvasHeight = shouldExpand
    ? sourceHeight + normalizedBarHeight * 2
    : sourceHeight;
  const matte: ShotMatte =
    existingMatte ?? {
      mode,
      top: normalizedBarHeight,
      bottom: normalizedBarHeight,
      ...(mode === "expanded" ? { sourceHeight } : {})
    };
  const resizedLayers = layers
    .filter((layer) => layer.id !== matteOverlayBitmapLayerId)
    .map((layer) =>
      shouldExpand
        ? {
            ...layer,
            height: layer.height + normalizedBarHeight * 2
          }
        : layer
    );
  const matteOverlay: BitmapLayer = {
    id: matteOverlayBitmapLayerId,
    kind: "paint",
    name: matteOverlayBitmapLayerName,
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: "normal",
    order: existingOverlay?.order ?? resizedLayers.length,
    bitmapPath: bitmapLayerPath(shot.id, matteOverlayBitmapLayerId),
    width: canvasWidth,
    height: canvasHeight
  };

  return {
    ...shot,
    layers: normalizeBitmapLayerOrder([...resizedLayers, matteOverlay]),
    swb: shot.swb
      ? {
          ...shot.swb,
          canvasHeight
        }
      : {
          version: swbFormatVersion,
          status: "owned" as const,
          canvasWidth,
          canvasHeight
        },
    presentation: {
      ...shot.presentation,
      matte
    }
  };
};

export const applyProjectMatte = (
  project: Project,
  mode: ShotMatte["mode"],
  shotIds: readonly string[] = project.shots.map((shot) => shot.id),
  barHeight = defaultShotMatteBarHeight
): Project => {
  const normalizedBarHeight = Math.max(1, Math.round(barHeight));
  const targetShotIds = new Set(shotIds);
  let didChange = false;
  const shots = project.shots.map((shot) => {
    if (!targetShotIds.has(shot.id)) {
      return shot;
    }

    const nextShot = applyMatteToShot(shot, mode, normalizedBarHeight);
    didChange ||= nextShot !== shot;
    return nextShot;
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

export const applyShotMatte = (
  project: Project,
  shotId: string,
  mode: ShotMatte["mode"],
  barHeight = defaultShotMatteBarHeight
): Project => applyProjectMatte(project, mode, [shotId], barHeight);

export const removeProjectMatte = (
  project: Project,
  shotIds: readonly string[] = project.shots.map((shot) => shot.id)
): Project => {
  const targetShotIds = new Set(shotIds);
  let didChange = false;
  const shots = project.shots.map((shot) => {
    const matte = targetShotIds.has(shot.id) ? matteForShot(shot) : undefined;
    if (!matte) {
      return shot;
    }

    const contentLayers = bitmapLayersForShot(shot).filter(
      (layer) =>
        layer.id !== matteOverlayBitmapLayerId &&
        layer.id !== dialogueOverlayBitmapLayerId
    );
    const targetHeight =
      matte.mode === "expanded"
        ? matte.sourceHeight ??
          Math.max(1, (shot.swb?.canvasHeight ?? contentLayers[0]?.height ?? 1) - matte.top - matte.bottom)
        : shot.swb?.canvasHeight ?? contentLayers[0]?.height ?? 1;
    const resizedLayers =
      matte.mode === "expanded"
        ? contentLayers.map((layer) => ({ ...layer, height: targetHeight }))
        : contentLayers;
    const activeLayerId = resizedLayers.some(
      (layer) => layer.id === shot.activeLayerId && layer.visible && !layer.locked
    )
      ? shot.activeLayerId
      : [...resizedLayers].reverse().find((layer) => layer.visible && !layer.locked)?.id;
    const { matte: _removedMatte, ...remainingPresentation } = shot.presentation ?? {};
    didChange = true;

    return {
      ...shot,
      layers: normalizeBitmapLayerOrder(resizedLayers),
      activeLayerId,
      swb: shot.swb
        ? {
            ...shot.swb,
            canvasHeight: targetHeight
          }
        : shot.swb,
      presentation:
        Object.keys(remainingPresentation).length > 0
          ? remainingPresentation
          : undefined
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

export const upsertDialogueOverlayBitmapLayer = (
  project: Project,
  shotId: string
): Project => {
  let didChange = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotId || !matteForShot(shot)) {
      return shot;
    }

    const layers = bitmapLayersForShot(shot);
    const width = shot.swb?.canvasWidth ?? Math.max(0, ...layers.map((layer) => layer.width));
    const height = shot.swb?.canvasHeight ?? Math.max(0, ...layers.map((layer) => layer.height));
    if (width <= 0 || height <= 0) {
      return shot;
    }

    const existingOverlay = layers.find((layer) => layer.id === dialogueOverlayBitmapLayerId);
    const overlay: BitmapLayer = {
      id: dialogueOverlayBitmapLayerId,
      kind: "paint",
      name: dialogueOverlayBitmapLayerName,
      visible: true,
      locked: true,
      opacity: 1,
      blendMode: "normal",
      order: existingOverlay?.order ?? layers.length,
      bitmapPath: bitmapLayerPath(shot.id, dialogueOverlayBitmapLayerId),
      width,
      height
    };
    const nextLayers = existingOverlay
      ? layers.map((layer) => (layer.id === existingOverlay.id ? overlay : layer))
      : [...layers, overlay];
    didChange = true;

    return {
      ...shot,
      layers: normalizeBitmapLayerOrder(nextLayers),
      activeLayerId: visibleBitmapLayerId(nextLayers, shot.activeLayerId)
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

export const removeProjectDialogueOverlay = (
  project: Project,
  shotIds: readonly string[] = project.shots.map((shot) => shot.id)
): Project => {
  const targetShotIds = new Set(shotIds);
  let didChange = false;
  const shots = project.shots.map((shot) => {
    if (
      !targetShotIds.has(shot.id) ||
      !bitmapLayersForShot(shot).some(
        (layer) => layer.id === dialogueOverlayBitmapLayerId
      )
    ) {
      return shot;
    }

    const layers = bitmapLayersForShot(shot).filter(
      (layer) => layer.id !== dialogueOverlayBitmapLayerId
    );
    didChange = true;
    return {
      ...shot,
      layers: normalizeBitmapLayerOrder(layers),
      activeLayerId: visibleBitmapLayerId(layers, shot.activeLayerId)
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

export const addImportedImages = (project: Project, images: ImportedImage[]): Project => {
  const existingPaths = new Set([
    ...project.shots.map((shot) => shot.imagePath),
    ...(project.parkedShots ?? []).map((shot) => shot.imagePath)
  ]);
  const pendingDeletedPaths = new Set(
    (project.pendingDeletedShots ?? []).map((shot) => shot.imagePath)
  );
  const newShots = images
    .filter((image) => !existingPaths.has(image.imagePath) && !pendingDeletedPaths.has(image.imagePath))
    .map((image, index) =>
      createShotFromImportedImage(image, project.shots.length + index, {
        sourceFileName: undefined,
        includeDefaultSketchLayer: false
      })
    );

  if (newShots.length === 0) {
    return project;
  }

  return normalizeShotOrder({
    ...project,
    shots: [...project.shots, ...newShots],
    updatedAt: now()
  });
};

export const addGeneratedShot = (
  project: Project,
  image: ImportedImage,
  selectedShotId?: string,
  placement: ShotPlacement = "after"
): Project => {
  const ordered = sortedShots(project.shots);
  const selectedIndex = selectedShotId
    ? ordered.findIndex((shot) => shot.id === selectedShotId)
    : -1;
  const insertIndex =
    selectedIndex === -1 ? ordered.length : placement === "after" ? selectedIndex + 1 : selectedIndex;
  const shotId = crypto.randomUUID();
  const width = image.width ?? 1920;
  const height = image.height ?? 1080;
  const drawingLayerId = "layer-drawing";
  const newShot: Shot = {
    id: shotId,
    imagePath: image.imagePath,
    previewPath: image.previewPath,
    fileName: image.fileName,
    sourceFileName: image.fileName,
    order: insertIndex,
    sketchLayers: [createDefaultSketchLayer([])],
    activeLayerTarget: "image",
    activeLayerId: drawingLayerId,
    layers: [
      createImageBitmapLayer(shotId, width, height),
      {
        id: drawingLayerId,
        kind: "paint",
        name: defaultSketchLayerName,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 1,
        bitmapPath: bitmapLayerPath(shotId, drawingLayerId),
        width,
        height
      }
    ],
    swb: {
      version: swbFormatVersion,
      status: "owned",
      canvasWidth: width,
      canvasHeight: height,
      baseFingerprint: image.fingerprint
    }
  };
  const nextShots = [...ordered.slice(0, insertIndex), newShot, ...ordered.slice(insertIndex)];

  return {
    ...project,
    shots: nextShots.map((shot, order) => ({ ...shot, order })),
    updatedAt: now()
  };
};

export const mergeExternalImageChanges = (project: Project, images: ImportedImage[]): Project => {
  if (images.length === 0) {
    return project;
  }

  const imageByPath = new Map(images.map((image) => [image.imagePath, image]));
  const existingPaths = new Set([
    ...project.shots.map((shot) => shot.imagePath),
    ...(project.parkedShots ?? []).map((shot) => shot.imagePath)
  ]);
  const pendingDeletedPaths = new Set(
    (project.pendingDeletedShots ?? []).map((shot) => shot.imagePath)
  );
  let didChange = false;
  const shots = project.shots.map((shot) => {
    const scanned = imageByPath.get(shot.imagePath);
    if (!scanned) {
      return shot;
    }

    const nextShot = ensureBitmapLayerMetadata(
      {
        ...shot,
        previewPath: scanned.previewPath ?? shot.previewPath,
        fileName: scanned.fileName ?? shot.fileName,
        sketchLayers: sketchLayersForShot(shot),
        swb: mergedSwbState(shot, scanned)
      },
      scanned
    );
    didChange = didChange || nextShot !== shot || nextShot.swb !== shot.swb;
    return nextShot;
  });
  const parkedShots = (project.parkedShots ?? []).map((shot) => {
    const scanned = imageByPath.get(shot.imagePath);
    if (!scanned) {
      return shot;
    }

    didChange = true;
    return ensureBitmapLayerMetadata(
      {
        ...shot,
        previewPath: scanned.previewPath ?? shot.previewPath,
        fileName: scanned.fileName ?? shot.fileName,
        swb: mergedSwbState(shot, scanned)
      },
      scanned
    );
  });
  const newShots = images
    .filter((image) => !existingPaths.has(image.imagePath) && !pendingDeletedPaths.has(image.imagePath))
    .map((image, index) =>
      createShotFromImportedImage(image, project.shots.length + index, {
        sourceFileName: undefined,
        includeDefaultSketchLayer: false
      })
    );

  if (!didChange && newShots.length === 0) {
    return project;
  }

  return normalizeShotOrder({
    ...project,
    shots: [...shots, ...newShots],
    parkedShots: project.parkedShots ? parkedShots : undefined,
    updatedAt: now()
  });
};

export const mergeFolderImages = (project: Project, images: ImportedImage[]): Project => {
  const parkedPaths = new Set((project.parkedShots ?? []).map((shot) => shot.imagePath));
  const pendingDeletedPaths = new Set(
    (project.pendingDeletedShots ?? []).map((shot) => shot.imagePath)
  );
  const mergeImages = images.filter(
    (image) => !pendingDeletedPaths.has(image.imagePath) && !parkedPaths.has(image.imagePath)
  );
  const scannedPaths = new Set(mergeImages.map((image) => image.imagePath));
  const imageByPath = new Map(mergeImages.map((image) => [image.imagePath, image]));
  const keptShots = sortedShots(project.shots)
    .filter((shot) => scannedPaths.has(shot.imagePath))
    .map((shot) => {
      const scanned = imageByPath.get(shot.imagePath);
      return {
        ...shot,
        previewPath: scanned?.previewPath ?? shot.previewPath,
        fileName: scanned?.fileName ?? shot.fileName,
        sketchLayers: sketchLayersForShot(shot),
        swb: scanned ? mergedSwbState(shot, scanned) : shot.swb
      };
    })
    .map((shot) => {
      const scanned = imageByPath.get(shot.imagePath);
      return ensureBitmapLayerMetadata(shot, scanned);
    });
  const keptPaths = new Set(keptShots.map((shot) => shot.imagePath));
  const newShots = mergeImages
    .filter((image) => !keptPaths.has(image.imagePath))
    .map((image, index) =>
      createShotFromImportedImage(image, keptShots.length + index, {
        sourceFileName: undefined,
        includeDefaultSketchLayer: false
      })
    );
  const keptShotIds = new Set(
    [...keptShots, ...(project.parkedShots ?? [])].map((shot) => shot.id)
  );

  return normalizeDialogueOrder(
    normalizeShotOrder({
      ...project,
      shots: [...keptShots, ...newShots],
      dialogues: project.dialogues.filter((dialogue) => keptShotIds.has(dialogue.shotId)),
      updatedAt: now()
    })
  );
};

export const deleteShots = (project: Project, shotIds: string[]): Project => {
  const deletedShotIds = new Set(shotIds);

  if (deletedShotIds.size === 0) {
    return project;
  }

  const orderedShots = sortedShots(project.shots);
  const deletedShots = orderedShots.filter((shot) => deletedShotIds.has(shot.id));

  if (deletedShots.length === 0) {
    return project;
  }

  const remainingShots = orderedShots
    .filter((shot) => !deletedShotIds.has(shot.id))
    .map((shot, order) => ({ ...shot, order }));
  const existingPending = project.pendingDeletedShots ?? [];
  const existingPendingKeys = new Set(
    existingPending.map((shot) => `${shot.id}\n${shot.imagePath}`)
  );
  const addedPending = deletedShots
    .map((shot) => ({
      id: shot.id,
      imagePath: shot.imagePath,
      fileName: shot.fileName
    }))
    .filter((shot) => {
      const key = `${shot.id}\n${shot.imagePath}`;
      if (existingPendingKeys.has(key)) {
        return false;
      }
      existingPendingKeys.add(key);
      return true;
    });
  const remainingShotIds = new Set(
    [...remainingShots, ...(project.parkedShots ?? [])].map((shot) => shot.id)
  );

  return normalizeDialogueOrder({
    ...project,
    shots: remainingShots,
    dialogues: project.dialogues.filter((dialogue) => remainingShotIds.has(dialogue.shotId)),
    pendingDeletedShots: [...existingPending, ...addedPending],
    updatedAt: now()
  });
};

export const reorderShots = (
  project: Project,
  activeShotId: string,
  overShotId: string,
  placement: ShotPlacement = "before"
): Project => {
  if (activeShotId === overShotId) {
    return project;
  }

  const ordered = sortedShots(project.shots);
  const fromIndex = ordered.findIndex((shot) => shot.id === activeShotId);
  const toIndex = ordered.findIndex((shot) => shot.id === overShotId);

  if (fromIndex === -1 || toIndex === -1) {
    return project;
  }

  const [moved] = ordered.splice(fromIndex, 1);
  const insertIndex =
    placement === "after"
      ? toIndex > fromIndex
        ? toIndex
        : toIndex + 1
      : toIndex > fromIndex
        ? toIndex - 1
        : toIndex;
  ordered.splice(insertIndex, 0, moved);

  return {
    ...project,
    shots: ordered.map((shot, index) => ({ ...shot, order: index })),
    updatedAt: now()
  };
};

export const reorderShotGroup = (
  project: Project,
  selectedShotIds: string[],
  overShotId: string,
  placement: ShotPlacement = "before"
): Project => {
  const selected = new Set(selectedShotIds);

  if (selected.size === 0 || selected.has(overShotId)) {
    return project;
  }

  const ordered = sortedShots(project.shots);
  const moving = ordered.filter((shot) => selected.has(shot.id));

  if (moving.length === 0) {
    return project;
  }

  const remaining = ordered.filter((shot) => !selected.has(shot.id));
  const targetIndex = remaining.findIndex((shot) => shot.id === overShotId);

  if (targetIndex === -1) {
    return project;
  }

  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  const nextShots = [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex)
  ];

  return {
    ...project,
    shots: nextShots.map((shot, index) => ({ ...shot, order: index })),
    updatedAt: now()
  };
};

export const parkShotGroup = (
  project: Project,
  shotIds: string[],
  options?: {
    targetParkedShotId?: string;
    placement?: ShotPlacement;
  }
): Project => {
  const selected = new Set(shotIds);

  if (selected.size === 0) {
    return project;
  }

  const ordered = sortedShots(project.shots);
  const moving = ordered.filter((shot) => selected.has(shot.id));

  if (moving.length === 0) {
    return project;
  }

  const remaining = ordered.filter((shot) => !selected.has(shot.id));
  const parked = sortedShots(project.parkedShots ?? []);
  const targetIndex = options?.targetParkedShotId
    ? parked.findIndex((shot) => shot.id === options.targetParkedShotId)
    : -1;
  const insertIndex =
    targetIndex === -1 ? parked.length : options?.placement === "after" ? targetIndex + 1 : targetIndex;
  const parkedShots = [
    ...parked.slice(0, insertIndex),
    ...moving,
    ...parked.slice(insertIndex)
  ].map((shot, order) => ({ ...shot, order }));

  return {
    ...project,
    shots: remaining.map((shot, order) => ({ ...shot, order })),
    parkedShots,
    updatedAt: now()
  };
};

export const restoreParkedShotGroup = (
  project: Project,
  parkedShotIds: string[],
  targetShotId: string | { type: "empty-board" },
  placement: ShotPlacement = "before"
): Project => {
  const selected = new Set(parkedShotIds);

  if (selected.size === 0) {
    return project;
  }

  const parked = sortedShots(project.parkedShots ?? []);
  const moving = parked.filter((shot) => selected.has(shot.id));

  if (moving.length === 0) {
    return project;
  }

  const ordered = sortedShots(project.shots);
  const emptyBoard = typeof targetShotId !== "string" && targetShotId.type === "empty-board";
  const targetIndex = ordered.findIndex((shot) => shot.id === targetShotId);

  if (emptyBoard ? ordered.length !== 0 : targetIndex === -1) {
    return project;
  }

  const insertIndex = emptyBoard ? 0 : placement === "after" ? targetIndex + 1 : targetIndex;
  const nextShots = [
    ...ordered.slice(0, insertIndex),
    ...moving,
    ...ordered.slice(insertIndex)
  ].map((shot, order) => ({ ...shot, order }));
  const nextParkedShots = parked
    .filter((shot) => !selected.has(shot.id))
    .map((shot, order) => ({ ...shot, order }));

  return {
    ...project,
    shots: nextShots,
    parkedShots: nextParkedShots.length > 0 ? nextParkedShots : undefined,
    updatedAt: now()
  };
};

export const duplicateShotAfter = (
  project: Project,
  sourceShotId: string,
  targetShotId: string | undefined,
  options: {
    shotId: string;
    imagePath: string;
    fileName: string;
    previewPath?: string;
    placement?: ShotPlacement;
  }
): Project => {
  const ordered = sortedShots(project.shots);
  const sourceShot = ordered.find((shot) => shot.id === sourceShotId);

  if (!sourceShot) {
    return project;
  }

  const targetIndex = targetShotId
    ? ordered.findIndex((shot) => shot.id === targetShotId)
    : -1;
  const placement = options.placement ?? "after";
  const insertIndex =
    targetIndex === -1
      ? ordered.length
      : placement === "before"
      ? targetIndex
      : targetIndex + 1;
  const layerIdMap = new Map<string, string>();
  const layers = bitmapLayersForShot(sourceShot).map((layer) => {
    const layerId = layer.id;
    layerIdMap.set(layer.id, layerId);
    return {
      ...layer,
      id: layerId,
      bitmapPath: bitmapLayerPath(options.shotId, layerId)
    };
  });
  const duplicatedShot: Shot = {
    ...sourceShot,
    id: options.shotId,
    imagePath: options.imagePath,
    previewPath: options.previewPath,
    fileName: options.fileName,
    sourceFileName: options.fileName,
    order: insertIndex,
    layers,
    activeLayerId: sourceShot.activeLayerId
      ? layerIdMap.get(sourceShot.activeLayerId) ?? sourceShot.activeLayerId
      : sourceShot.activeLayerId,
    swb: sourceShot.swb
      ? {
          ...sourceShot.swb,
          status: "owned" as const,
          sourcePath: sourceShot.swb.sourcePath,
          archivePath: sourceShot.swb.archivePath,
          statusMessage: undefined,
          acceptedExternalEditAt: undefined
        }
      : sourceShot.swb
  };
  const copiedDialogues = dialoguesForShot(project, sourceShot.id).map((dialogue, index) => ({
    ...dialogue,
    id: crypto.randomUUID(),
    shotId: options.shotId,
    order: index
  }));
  const nextShots = [
    ...ordered.slice(0, insertIndex),
    duplicatedShot,
    ...ordered.slice(insertIndex)
  ].map((shot, order) => ({ ...shot, order }));

  return normalizeDialogueOrder({
    ...project,
    shots: nextShots,
    dialogues: [...project.dialogues, ...copiedDialogues],
    updatedAt: now()
  });
};

export const addDialogue = (
  project: Project,
  shotId: string,
  text = "",
  id: string = crypto.randomUUID()
): Project => {
  const nextOrder = dialoguesForShot(project, shotId).length;

  return {
    ...project,
    dialogues: [
      ...project.dialogues,
      {
        id,
        shotId,
        text,
        order: nextOrder
      }
    ],
    updatedAt: now()
  };
};

export const updateDialogueText = (project: Project, dialogueId: string, text: string): Project => {
  return {
    ...project,
    dialogues: project.dialogues.map((dialogue) =>
      dialogue.id === dialogueId ? { ...dialogue, text } : dialogue
    ),
    updatedAt: now()
  };
};

export const removeDialogue = (project: Project, dialogueId: string): Project => {
  return normalizeDialogueOrder({
    ...project,
    dialogues: project.dialogues.filter((dialogue) => dialogue.id !== dialogueId),
    updatedAt: now()
  });
};

export const moveDialogueToShot = (
  project: Project,
  dialogueId: string,
  targetShotId: string
): Project => {
  const dialogue = project.dialogues.find((item) => item.id === dialogueId);

  if (!dialogue || dialogue.shotId === targetShotId) {
    return project;
  }

  const nextOrder = dialoguesForShot(project, targetShotId).length;

  const movedDialogues = project.dialogues.map((item) =>
    item.id === dialogueId ? { ...item, shotId: targetShotId, order: nextOrder } : item
  );

  return normalizeDialogueOrder({
    ...project,
    dialogues: movedDialogues,
    updatedAt: now()
  });
};

export const copyDialogueToShot = (
  project: Project,
  dialogueId: string,
  targetShotId: string,
  id: string = crypto.randomUUID()
): Project => {
  const dialogue = project.dialogues.find((item) => item.id === dialogueId);
  const targetShot = project.shots.find((shot) => shot.id === targetShotId);

  if (!dialogue || !targetShot) {
    return project;
  }

  return {
    ...project,
    dialogues: [
      ...project.dialogues,
      {
        ...dialogue,
        id,
        shotId: targetShotId,
        order: dialoguesForShot(project, targetShotId).length
      }
    ],
    updatedAt: now()
  };
};

























export const bitmapLayerPath = (shotId: string, layerId: string): string =>
  `.storyboard-workbench/layers/${shotId}/${layerId}.png`;

export const createImageBitmapLayer = (
  shotId: string,
  width: number,
  height: number
): BitmapLayer => ({
  id: imageBitmapLayerId,
  kind: "image",
  name: imageBitmapLayerName,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  bitmapPath: bitmapLayerPath(shotId, imageBitmapLayerId),
  width,
  height
});

export const bitmapLayersForShot = (shot: Shot): BitmapLayer[] => {
  return normalizeBitmapLayerOrder(
    uniqueBitmapLayers(
      [...(shot.layers ?? [])].sort((a, b) => a.order - b.order)
    )
  );
};

const uniqueBitmapLayers = (layers: BitmapLayer[]): BitmapLayer[] => {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const uniqueLayers: BitmapLayer[] = [];

  for (const layer of layers) {
    if (seenIds.has(layer.id) || seenPaths.has(layer.bitmapPath)) {
      continue;
    }

    seenIds.add(layer.id);
    seenPaths.add(layer.bitmapPath);
    uniqueLayers.push(layer);
  }

  return uniqueLayers;
};

export const ensureBitmapLayerMetadata = (shot: Shot, image?: ImportedImage): Shot => {
  if ((shot.layers?.length ?? 0) > 0) {
    const layers = bitmapLayersForShot(shot);
    const repairedLayers =
      layers.length < (shot.layers?.length ?? 0) &&
      !layers.some((layer) => layer.kind === "image") &&
      scannedMetadataHasImageLayer(image)
        ? [createImageBitmapLayer(shot.id, image?.width ?? shot.swb?.canvasWidth ?? 1920, image?.height ?? shot.swb?.canvasHeight ?? 1080), ...layers]
        : layers;

    return {
      ...shot,
      layers: repairedLayers,
      activeLayerId: shot.activeLayerId ?? repairedLayers[0]?.id
    };
  }

  const width = image?.width ?? shot.swb?.canvasWidth ?? 1920;
  const height = image?.height ?? shot.swb?.canvasHeight ?? 1080;
  const sketchLayers = sketchLayersForShot(shot).filter((layer) => !isEmptyDefaultSketchLayer(layer));
  const layers: BitmapLayer[] = [
    createImageBitmapLayer(shot.id, width, height),
    ...sketchLayers.map((layer, index) => ({
      id: layer.id,
      kind: "paint" as const,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode ?? "normal",
      order: index + 1,
      bitmapPath: bitmapLayerPath(shot.id, layer.id),
      width,
      height
    }))
  ];

  return {
    ...shot,
    layers,
    activeLayerId: imageBitmapLayerId
  };
};

const isEmptyDefaultSketchLayer = (layer: SketchLayer): boolean => {
  return (
    layer.id === "layer-default" &&
    layer.name === defaultSketchLayerName &&
    layer.strokes.length === 0
  );
};

const scannedMetadataHasImageLayer = (image?: ImportedImage): boolean => {
  return Boolean(
    image?.swbMetadata?.layers.some(
      (layer) => layer.id === imageBitmapLayerId || layer.kind === "image"
    )
  );
};

export type AddBitmapLayerOptions = {
  id?: string;
  name?: string;
  width: number;
  height: number;
};

export const addBitmapLayer = (
  project: Project,
  shotId: string,
  options: AddBitmapLayerOptions
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => {
    const layerId = options.id ?? nextBitmapLayerId(shotId, layers);
    const nextLayer: BitmapLayer = {
      id: layerId,
      kind: "paint",
      name: options.name ?? "Layer",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      order: layers.length,
      bitmapPath: bitmapLayerPath(shot.id, layerId),
      width: options.width,
      height: options.height
    };

    return {
      layers: [...layers, nextLayer],
      activeLayerId: nextLayer.id
    };
  });
};

export const copyBitmapLayerToShot = (
  project: Project,
  sourceShotId: string,
  sourceLayerId: string,
  targetShotId: string,
  targetLayerId: string,
  placementTargetLayerId?: string,
  placement: "before" | "after" = "after"
): Project => {
  const sourceShot = project.shots.find((shot) => shot.id === sourceShotId);
  const targetShot = project.shots.find((shot) => shot.id === targetShotId);
  const sourceLayer = sourceShot
    ? bitmapLayersForShot(sourceShot).find((layer) => layer.id === sourceLayerId)
    : undefined;

  if (!sourceShot || !targetShot || !sourceLayer) {
    return project;
  }

  return updateBitmapLayers(project, targetShotId, (_shot, layers) => {
    const copiedLayer = {
      ...sourceLayer,
      id: targetLayerId,
      order: layers.length,
      bitmapPath: bitmapLayerPath(targetShotId, targetLayerId)
    };
    const targetIndex = placementTargetLayerId
      ? layers.findIndex((layer) => layer.id === placementTargetLayerId)
      : -1;
    const insertIndex =
      targetIndex === -1 ? layers.length : placement === "before" ? targetIndex : targetIndex + 1;
    const nextLayers = [...layers];
    nextLayers.splice(insertIndex, 0, copiedLayer);

    return {
      layers: nextLayers,
      activeLayerId: targetLayerId
    };
  });
};

const nextBitmapLayerId = (shotId: string, layers: BitmapLayer[]): string => {
  const existingIds = new Set(layers.map((layer) => layer.id));
  let index = layers.length;
  let layerId = `layer-${shotId}-${index}`;

  while (existingIds.has(layerId)) {
    index += 1;
    layerId = `layer-${shotId}-${index}`;
  }

  return layerId;
};

export const selectBitmapLayer = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => {
    const target = layers.find((layer) => layer.id === layerId && layer.visible);

    return {
      layers,
      activeLayerId: target?.id ?? shot.activeLayerId
    };
  });
};

export const updateBitmapLayer = (
  project: Project,
  shotId: string,
  layerId: string,
  patch: Partial<Pick<BitmapLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => ({
    layers: layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            name: layer.locked ? layer.name : patch.name ?? layer.name,
            visible: patch.visible ?? layer.visible,
            locked: patch.locked ?? layer.locked,
            opacity:
              layer.locked || patch.opacity === undefined
                ? layer.opacity
                : Math.min(1, Math.max(0, patch.opacity)),
            blendMode: layer.locked ? layer.blendMode : patch.blendMode ?? layer.blendMode
          }
        : layer
    ),
    activeLayerId: shot.activeLayerId ?? layers[0]?.id
  }));
};

export const moveBitmapLayer = (
  project: Project,
  shotId: string,
  layerId: string,
  targetLayerId: string,
  placement: "before" | "after" = "before"
): Project => {
  if (layerId === targetLayerId) {
    return project;
  }

  return updateBitmapLayers(project, shotId, (shot, layers) => {
    const movingLayer = layers.find((layer) => layer.id === layerId);
    const targetLayer = layers.find((layer) => layer.id === targetLayerId);

    if (!movingLayer || !targetLayer) {
      return { layers, activeLayerId: shot.activeLayerId ?? layers[0]?.id };
    }

    const remainingLayers = layers.filter((layer) => layer.id !== layerId);
    const targetIndex = remainingLayers.findIndex((layer) => layer.id === targetLayerId);
    const insertIndex =
      targetIndex === -1
        ? remainingLayers.length
        : placement === "after"
          ? targetIndex + 1
          : targetIndex;
    const nextLayers = [...remainingLayers];
    nextLayers.splice(insertIndex, 0, movingLayer);

    return {
      layers: nextLayers,
      activeLayerId: shot.activeLayerId ?? layers[0]?.id
    };
  });
};

export const moveBitmapLayerGroup = (
  project: Project,
  shotId: string,
  layerIds: string[],
  targetLayerId: string,
  placement: "before" | "after" = "before"
): Project => {
  const shot = project.shots.find((item) => item.id === shotId);
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const selectedLayerIds = new Set(layerIds);
  const movingLayerIds = new Set(
    layers
      .filter((layer) => selectedLayerIds.has(layer.id) && !layer.locked)
      .map((layer) => layer.id)
  );

  if (
    !shot ||
    movingLayerIds.size === 0 ||
    movingLayerIds.has(targetLayerId) ||
    !layers.some((layer) => layer.id === targetLayerId)
  ) {
    return project;
  }

  return updateBitmapLayers(project, shotId, (currentShot, currentLayers) => {
    const movingLayers = currentLayers.filter((layer) => movingLayerIds.has(layer.id));
    const remainingLayers = currentLayers.filter((layer) => !movingLayerIds.has(layer.id));
    const targetIndex = remainingLayers.findIndex((layer) => layer.id === targetLayerId);
    const insertIndex =
      targetIndex === -1
        ? remainingLayers.length
        : placement === "after"
          ? targetIndex + 1
          : targetIndex;
    const nextLayers = [...remainingLayers];
    nextLayers.splice(insertIndex, 0, ...movingLayers);
    const activeLayerId =
      currentShot.activeLayerId && selectedLayerIds.has(currentShot.activeLayerId) && !movingLayerIds.has(currentShot.activeLayerId)
        ? movingLayers.at(-1)?.id
        : currentShot.activeLayerId ?? movingLayers.at(-1)?.id;

    return {
      layers: nextLayers,
      activeLayerId
    };
  });
};

export const updateBitmapLayerGroupOpacity = (
  project: Project,
  shotId: string,
  layerIds: string[],
  deltaOpacity: number,
  initialOpacityByLayerId?: Record<string, number>
): Project => {
  const selectedLayerIds = new Set(layerIds);

  return updateBitmapLayers(project, shotId, (shot, layers) => ({
    layers: layers.map((layer) => {
      if (!selectedLayerIds.has(layer.id) || layer.locked) {
        return layer;
      }

      const initialOpacity = initialOpacityByLayerId?.[layer.id] ?? layer.opacity ?? 1;
      return {
        ...layer,
        opacity: Math.round(Math.min(1, Math.max(0, initialOpacity + deltaOpacity)) * 1000) / 1000
      };
    }),
    activeLayerId: shot.activeLayerId ?? layers[0]?.id
  }));
};

export const deleteBitmapLayer = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => {
    const target = layers.find((layer) => layer.id === layerId);

    if (!target || layers.length <= 1) {
      return { layers, activeLayerId: shot.activeLayerId ?? layers[0]?.id };
    }

    const nextLayers = layers.filter((layer) => layer.id !== layerId);
    const deletedIndex = layers.findIndex((layer) => layer.id === layerId);
    const activeLayerId =
      shot.activeLayerId === layerId
        ? nextLayers[Math.max(0, Math.min(deletedIndex, nextLayers.length - 1))]?.id
        : shot.activeLayerId ?? nextLayers[0]?.id;

    return { layers: nextLayers, activeLayerId };
  });
};

export const mergeBitmapLayerDown = (
  project: Project,
  shotId: string,
  sourceLayerId: string,
  targetLayerId: string
): Project => {
  if (sourceLayerId === targetLayerId) {
    return project;
  }

  const shot = project.shots.find((item) => item.id === shotId);
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const sourceLayer = layers.find((layer) => layer.id === sourceLayerId);
  const targetLayer = layers.find((layer) => layer.id === targetLayerId);
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceLayerId);
  const targetIndex = layers.findIndex((layer) => layer.id === targetLayerId);

  if (
    !sourceLayer ||
    !targetLayer ||
    !sourceLayer.visible ||
    !targetLayer.visible ||
    sourceLayer.locked ||
    targetLayer.locked ||
    sourceIndex <= targetIndex
  ) {
    return project;
  }

  return updateBitmapLayers(project, shotId, (shot, layers) => {
    return {
      layers: layers
        .filter((layer) => layer.id !== sourceLayerId)
        .map((layer) =>
          layer.id === targetLayerId
            ? {
                ...layer,
                visible: true,
                opacity: 1,
                blendMode: "normal"
              }
            : layer
        ),
      activeLayerId: targetLayerId
    };
  });
};

export const mergeSelectedBitmapLayers = (
  project: Project,
  shotId: string,
  layerIds: string[]
): Project => {
  const shot = project.shots.find((item) => item.id === shotId);
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const selectedLayerIds = new Set(layerIds);
  const selectedLayers = layers.filter((layer) => selectedLayerIds.has(layer.id));

  if (
    !shot ||
    selectedLayers.length < 2 ||
    selectedLayers.some((layer) => !layer.visible || layer.locked)
  ) {
    return project;
  }

  const targetLayer = selectedLayers[0];
  const deleteLayerIds = new Set(selectedLayers.slice(1).map((layer) => layer.id));

  return updateBitmapLayers(project, shotId, () => ({
    layers: layers
      .filter((layer) => !deleteLayerIds.has(layer.id))
      .map((layer) =>
        layer.id === targetLayer.id
          ? {
              ...layer,
              visible: true,
              opacity: 1,
              blendMode: "normal"
            }
          : layer
      ),
    activeLayerId: targetLayer.id
  }));
};

export const mergeVisibleBitmapLayers = (
  project: Project,
  shotId: string
): Project => {
  const shot = project.shots.find((item) => item.id === shotId);
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const visibleLayers = layers.filter((layer) => layer.visible);

  if (
    !shot ||
    visibleLayers.length < 2
  ) {
    return project;
  }

  const mergedLayerId = nextBitmapLayerId(shot.id, layers);
  const canvasWidth = Math.max(...visibleLayers.map((layer) => layer.width), 1);
  const canvasHeight = Math.max(...visibleLayers.map((layer) => layer.height), 1);
  const visibleLayerIds = new Set(visibleLayers.map((layer) => layer.id));
  const lockedVisibleLayerIds = new Set(
    visibleLayers.filter((layer) => layer.locked).map((layer) => layer.id)
  );
  const mergedLayer: BitmapLayer = {
    id: mergedLayerId,
    kind: "paint",
    name: "Merged",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    order: layers.length,
    bitmapPath: bitmapLayerPath(shot.id, mergedLayerId),
    width: canvasWidth,
    height: canvasHeight
  };

  return updateBitmapLayers(project, shotId, () => ({
    layers: layers
      .filter((layer) => !visibleLayerIds.has(layer.id) || lockedVisibleLayerIds.has(layer.id))
      .map((layer) =>
        lockedVisibleLayerIds.has(layer.id)
          ? {
              ...layer,
              visible: false
            }
          : layer
      )
      .concat(mergedLayer),
    activeLayerId: mergedLayer.id
  }));
};

export const clearBitmapLayer = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => ({
    layers: layers.map((layer) => (layer.id === layerId ? { ...layer, cleared: true } : layer)),
    activeLayerId: layerId
  }));
};

export const markBitmapLayerPainted = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateBitmapLayers(project, shotId, (shot, layers) => ({
    layers: layers.map((layer) => {
      if (layer.id !== layerId) {
        return layer;
      }

      const { cleared, ...paintedLayer } = layer;
      return paintedLayer;
    }),
    activeLayerId: layerId
  }));
};





export const createRenamePlan = (
  project: Project,
  options: RenamePlanOptions = {}
): RenamePlanItem[] => {
  const namingPrefix = saveFilePrefix(project, options);
  const reservedPaths = new Set((project.parkedShots ?? []).map((shot) => shot.imagePath));
  let sequence = 0;

  return sortedShots(project.shots).map((shot, index) => {
    const directory = dirname(shot.imagePath);
    let finalFileName = orderedFileName(namingPrefix, shot.fileName, sequence);
    let finalPath = joinPath(directory, finalFileName);
    while (reservedPaths.has(finalPath)) {
      sequence += 1;
      finalFileName = orderedFileName(namingPrefix, shot.fileName, sequence);
      finalPath = joinPath(directory, finalFileName);
    }
    sequence += 1;

    return {
      shotId: shot.id,
      fromPath: shot.imagePath,
      temporaryPath: joinPath(directory, `.storyboard-renaming-${shot.id}${extension(shot.fileName)}`),
      finalPath,
      finalFileName
    };
  });
};

export const applyRenamePlan = (project: Project, plan: RenamePlanItem[]): Project => {
  const planByShotId = new Map(plan.map((item) => [item.shotId, item]));

  return {
    ...project,
    shots: project.shots.map((shot) => {
      const item = planByShotId.get(shot.id);
      return item
        ? {
            ...shot,
            imagePath: item.finalPath,
            fileName: item.finalFileName,
            sourceFileName: stripOrderPrefix(item.finalFileName)
          }
        : shot;
    }),
    updatedAt: now()
  };
};

export const sketchLayersForShot = (shot: Shot): SketchLayer[] => {
  return normalizeSketchLayerOrder(
    (shot.sketchLayers ?? [])
      .map((layer, index) => ({
        ...layer,
        order: layer.order ?? index,
        visible: layer.visible ?? true,
        locked: layer.locked ?? false,
        opacity: layer.opacity ?? 1,
        blendMode: layer.blendMode ?? "normal",
        strokes: [...(layer.strokes ?? [])]
      }))
      .sort((a, b) => a.order - b.order)
  );
};

export const flattenSketchLayers = (layers: SketchLayer[]): SketchStroke[] => {
  return layers
    .filter((layer) => layer.visible)
    .flatMap((layer) =>
      layer.strokes.map((stroke) => ({
        ...stroke,
        opacity: (stroke.opacity ?? 1) * layer.opacity
      }))
    );
};

export const activeSketchLayerForShot = (shot: Shot): SketchLayer => {
  const layers = sketchLayersForShot(shot);
  return (
    layers.find((layer) => layer.id === shot.activeSketchLayerId) ??
    layers[0] ??
    createDefaultSketchLayer([])
  );
};

export const createDefaultSketchLayer = (strokes: SketchStroke[]): SketchLayer => ({
  id: "layer-default",
  name: defaultSketchLayerName,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  strokes: [...strokes]
});

const normalizeSketchLayerOrder = (layers: SketchLayer[]): SketchLayer[] => {
  return layers.map((layer, order) => ({
    ...layer,
    order,
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
    opacity: layer.opacity ?? 1,
    blendMode: layer.blendMode ?? "normal",
    strokes: [...(layer.strokes ?? [])]
  }));
};

const normalizeBitmapLayerOrder = (layers: BitmapLayer[]): BitmapLayer[] => {
  const contentLayers = layers.filter(
    (layer) =>
      layer.id !== matteOverlayBitmapLayerId &&
      layer.id !== dialogueOverlayBitmapLayerId
  );
  const matteLayers = layers.filter((layer) => layer.id === matteOverlayBitmapLayerId);
  const dialogueLayers = layers.filter((layer) => layer.id === dialogueOverlayBitmapLayerId);

  return [...contentLayers, ...matteLayers, ...dialogueLayers].map((layer, order) => ({
    ...layer,
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
    opacity: layer.opacity ?? 1,
    blendMode: layer.blendMode ?? "normal",
    order
  }));
};

const visibleBitmapLayerId = (layers: BitmapLayer[], preferredLayerId?: string): string | undefined => {
  const preferredLayer = layers.find((layer) => layer.id === preferredLayerId);
  if (preferredLayer?.visible) {
    return preferredLayer.id;
  }

  return [...layers].reverse().find((layer) => layer.visible)?.id;
};

const updateBitmapLayers = (
  project: Project,
  shotId: string,
  update: (shot: Shot, layers: BitmapLayer[]) => { layers: BitmapLayer[]; activeLayerId?: string }
): Project => {
  let didChange = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotId) {
      return shot;
    }

    const currentLayers = bitmapLayersForShot(shot);
    const result = update(shot, currentLayers);
    const nextLayers = normalizeBitmapLayerOrder(result.layers);
    didChange = true;

    return {
      ...shot,
      layers: nextLayers,
      activeLayerId: visibleBitmapLayerId(nextLayers, result.activeLayerId ?? shot.activeLayerId)
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};



export const projectNeedsSwbImport = (project: Project): boolean => {
  return [...project.shots, ...(project.parkedShots ?? [])].some(
    (shot) =>
      shot.swb?.status === "non-swb" ||
      shot.swb?.status === "compatible-external-edit" ||
      shot.swb?.status === "incompatible-external-edit"
  );
};

export const projectHasSwbWarning = (project: Project): boolean => {
  return [...project.shots, ...(project.parkedShots ?? [])].some(
    (shot) =>
      shot.swb?.status === "non-swb" ||
      shot.swb?.status === "compatible-external-edit" ||
      shot.swb?.status === "incompatible-external-edit"
  );
};

export const projectAcceptedExternalEdits = (project: Project): boolean => {
  return [...project.shots, ...(project.parkedShots ?? [])].some((shot) =>
    Boolean(shot.swb?.acceptedExternalEditAt)
  );
};

export const validateRenamePlan = (
  plan: RenamePlanItem[],
  existingPaths: ReadonlySet<string>
): RenamePreflightResult => {
  const sourcePaths = new Set(plan.map((item) => item.fromPath));
  const issues = plan.flatMap((item) => {
    const itemIssues: RenamePreflightResult["issues"] = [];

    if (item.fromPath !== item.temporaryPath && existingPaths.has(item.temporaryPath)) {
      itemIssues.push({
        path: item.temporaryPath,
        reason: "temporary-exists",
        message: `Temporary rename file already exists: ${item.temporaryPath}`
      });
    }

    if (
      item.fromPath !== item.finalPath &&
      existingPaths.has(item.finalPath) &&
      !sourcePaths.has(item.finalPath)
    ) {
      itemIssues.push({
        path: item.finalPath,
        reason: "final-exists",
        message: `Target file already exists: ${item.finalPath}`
      });
    }

    return itemIssues;
  });

  return {
    ok: issues.length === 0,
    issues
  };
};

const normalizeShotOrder = (project: Project): Project => {
  return {
    ...project,
    shots: sortedShots(project.shots).map((shot, index) => ({ ...shot, order: index }))
  };
};

const normalizeDialogueOrder = (project: Project): Project => {
  const dialoguesByShot = new Map<string, Dialogue[]>();

  for (const dialogue of project.dialogues) {
    const group = dialoguesByShot.get(dialogue.shotId) ?? [];
    group.push(dialogue);
    dialoguesByShot.set(dialogue.shotId, group);
  }

  const normalized = project.dialogues.map((dialogue) => {
    const group = dialoguesByShot.get(dialogue.shotId) ?? [];
    const orderedGroup = [...group].sort((a, b) => a.order - b.order);
    return {
      ...dialogue,
      order: orderedGroup.findIndex((item) => item.id === dialogue.id)
    };
  });

  return {
    ...project,
    dialogues: normalized
  };
};

const createShotFromImportedImage = (
  image: ImportedImage,
  order: number,
  options: {
    sourceFileName?: string;
    includeDefaultSketchLayer: boolean;
  }
): Shot => {
  const shotId = crypto.randomUUID();
  const width = image.width ?? image.swbMetadata?.canvasWidth ?? 1920;
  const height = image.height ?? image.swbMetadata?.canvasHeight ?? 1080;

  return {
    id: shotId,
    imagePath: image.imagePath,
    previewPath: image.previewPath,
    fileName: image.fileName,
    sourceFileName: options.sourceFileName,
    order,
    sketchLayers: options.includeDefaultSketchLayer ? [createDefaultSketchLayer([])] : [],
    activeLayerTarget: "image",
    activeLayerId: imageBitmapLayerId,
    presentation: image.swbMetadata?.presentation,
    layers: [createImageBitmapLayer(shotId, width, height)],
    swb: swbStateForImportedImage(image)
  };
};

const swbStateForImportedImage = (image: ImportedImage): ShotSwbState => {
  if (isStandaloneLayeredTiffSnapshot(image)) {
    return {
      version: swbFormatVersion,
      status: "non-swb",
      canvasWidth: image.swbMetadata?.canvasWidth ?? image.width ?? 0,
      canvasHeight: image.swbMetadata?.canvasHeight ?? image.height ?? 0,
      baseFingerprint: image.fingerprint,
      statusMessage: "Import to convert this Photoshop layered TIFF into Storyboard Flow Format"
    };
  }

  if (image.swbMetadata) {
    return {
      version: image.swbMetadata.version,
      status: "owned",
      canvasWidth: image.swbMetadata.canvasWidth,
      canvasHeight: image.swbMetadata.canvasHeight,
      baseFingerprint: image.swbMetadata.baseFingerprint,
      sourcePath: image.swbMetadata.sourcePath,
      archivePath: image.swbMetadata.archivePath
    };
  }

  return {
    version: swbFormatVersion,
    status: "non-swb",
    canvasWidth: image.width ?? 0,
    canvasHeight: image.height ?? 0,
    baseFingerprint: image.fingerprint,
    statusMessage: "Import to convert this image into Storyboard Flow Format"
  };
};

const mergedSwbState = (shot: Shot, image: ImportedImage): ShotSwbState => {
  const existing = shot.swb;
  const metadata = image.swbMetadata;

  if (!existing || existing.status === "non-swb") {
    return swbStateForImportedImage(image);
  }

  if (!metadata) {
    if (image.fingerprint && existing.baseFingerprint && image.fingerprint === existing.baseFingerprint) {
      return {
        ...existing,
        status: "owned",
        statusMessage: undefined
      };
    }

    return {
      ...existing,
      status: "incompatible-external-edit",
      statusMessage: "SWB metadata is missing from this TIFF"
    };
  }

  if (image.fingerprint && existing.baseFingerprint && image.fingerprint === existing.baseFingerprint) {
    return {
      ...existing,
      status: "owned",
      baseFingerprint: image.fingerprint,
      statusMessage: undefined
    };
  }

  if (metadata.shotId !== shot.id) {
    return {
      ...existing,
      status: "incompatible-external-edit",
      statusMessage: "SWB shot id in TIFF does not match project metadata"
    };
  }

  if (
    (image.width && image.width !== existing.canvasWidth) ||
    (image.height && image.height !== existing.canvasHeight)
  ) {
    return {
      ...existing,
      status: "incompatible-external-edit",
      statusMessage: "TIFF dimensions changed outside Storyboard Flow"
    };
  }

  const savedFingerprint = existing.baseFingerprint ?? metadata.baseFingerprint;
  if (image.fingerprint && savedFingerprint && image.fingerprint !== savedFingerprint) {
    return {
      ...existing,
      status: "compatible-external-edit",
      statusMessage: "Import external Photoshop edits into Storyboard Flow"
    };
  }

  return {
    ...existing,
    status: "owned",
    baseFingerprint: image.fingerprint ?? savedFingerprint ?? existing.baseFingerprint,
    statusMessage: undefined
  };
};

const saveFilePrefix = (project: Project, options: RenamePlanOptions): string => {
  const naming = project.naming ?? defaultProjectNaming;
  const projectName = sanitizeFileNamePart(project.name);
  const sceneCode = sanitizeFileNamePart(
    naming.sceneCode || (options.allowDefaultNamingFields ? defaultSaveNaming.sceneCode : "")
  );
  const artistName = sanitizeFileNamePart(
    naming.artistName || (options.allowDefaultNamingFields ? defaultSaveNaming.artistName : "")
  );
  const version = sanitizeVersion(
    naming.version || (options.allowDefaultNamingFields ? defaultSaveNaming.version : "")
  );

  return [projectName, sceneCode, "stb", artistName, version]
    .filter((part) => part.length > 0)
    .join("_");
};

const orderedFileName = (prefix: string, fileName: string, index: number): string => {
  const ext = extension(fileName);
  return `${prefix}_${String((index + 1) * 10).padStart(4, "0")}${ext}`;
};

const sanitizeVersion = (value: string): string => {
  const sanitized = sanitizeFileNamePart(value);
  if (/^\d+$/.test(sanitized)) {
    return `v${sanitized.padStart(3, "0")}`;
  }

  return sanitized;
};

const sanitizeFileNamePart = (value: string): string => {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const stripOrderPrefix = (fileName: string): string => {
  return fileName.replace(/^\d{3,}[_ -]+/, "");
};

const extension = (fileName: string): string => {
  const match = /(\.[^./\\]+)$/.exec(fileName);
  return match?.[1] ?? "";
};

const stripExtension = (fileName: string): string => {
  const ext = extension(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
};

const dirname = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index);
};

const joinPath = (directory: string, fileName: string): string => {
  return directory === "." ? fileName : `${directory}/${fileName}`;
};
