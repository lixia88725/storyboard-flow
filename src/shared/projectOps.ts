import type {
  BitmapLayer,
  Dialogue,
  ImportedImage,
  Project,
  ProjectNaming,
  RenamePlanItem,
  RenamePreflightResult,
  Shot,
  ShotSwbState,
  SketchLayer,
  SketchStroke
} from "./types";

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

export const addImportedImages = (project: Project, images: ImportedImage[]): Project => {
  const existingPaths = new Set(project.shots.map((shot) => shot.imagePath));
  const newShots = images
    .filter((image) => !existingPaths.has(image.imagePath))
    .map((image, index) =>
      createShotFromImportedImage(image, project.shots.length + index, {
        sourceFileName: undefined,
        includeDefaultSketchLayer: false
      })
    );

  return normalizeShotOrder({
    ...project,
    shots: [...project.shots, ...newShots],
    updatedAt: now()
  });
};

export const addGeneratedShot = (
  project: Project,
  image: ImportedImage,
  selectedShotId?: string
): Project => {
  const ordered = sortedShots(project.shots);
  const selectedIndex = selectedShotId
    ? ordered.findIndex((shot) => shot.id === selectedShotId)
    : -1;
  const insertIndex = selectedIndex === -1 ? ordered.length : selectedIndex + 1;
  const shotId = crypto.randomUUID();
  const newShot: Shot = {
    id: shotId,
    imagePath: image.imagePath,
    previewPath: image.previewPath,
    fileName: image.fileName,
    sourceFileName: image.fileName,
    order: insertIndex,
    sketchLayers: [createDefaultSketchLayer([])],
    activeLayerTarget: "image",
    activeLayerId: imageBitmapLayerId,
    layers: [createImageBitmapLayer(shotId, image.width ?? 1920, image.height ?? 1080)],
    swb: {
      version: swbFormatVersion,
      status: "owned",
      canvasWidth: image.width ?? 1920,
      canvasHeight: image.height ?? 1080,
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

export const mergeFolderImages = (project: Project, images: ImportedImage[]): Project => {
  const scannedPaths = new Set(images.map((image) => image.imagePath));
  const imageByPath = new Map(images.map((image) => [image.imagePath, image]));
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
  const newShots = images
    .filter((image) => !keptPaths.has(image.imagePath))
    .map((image, index) =>
      createShotFromImportedImage(image, keptShots.length + index, {
        sourceFileName: undefined,
        includeDefaultSketchLayer: false
      })
    );
  const keptShotIds = new Set(keptShots.map((shot) => shot.id));

  return normalizeDialogueOrder(
    normalizeShotOrder({
      ...project,
      shots: [...keptShots, ...newShots],
      dialogues: project.dialogues.filter((dialogue) => keptShotIds.has(dialogue.shotId)),
      updatedAt: now()
    })
  );
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
  const adjustedToIndex = placement === "after" && toIndex > fromIndex ? toIndex : toIndex + 1;
  ordered.splice(placement === "after" ? adjustedToIndex : toIndex, 0, moved);

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

export const updateSketch = (
  project: Project,
  shotId: string,
  strokes: SketchStroke[],
  layerId?: string
): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) => {
      if (shot.id !== shotId) {
        return shot;
      }

      const layers = sketchLayersForShot(shot);
      const targetLayerId = layerId ?? shot.activeSketchLayerId ?? layers[0]?.id;
      const targetLayer = layers.find((layer) => layer.id === targetLayerId) ?? layers[0];
      if (!targetLayer) {
        if (strokes.length === 0) {
          return shot;
        }
        const nextLayers = [createDefaultSketchLayer(strokes)];
        return {
          ...shot,
          activeLayerTarget: "sketch",
          activeSketchLayerId: nextLayers[0].id,
          sketchLayers: nextLayers
        };
      }
      const nextLayers = layers.map((layer) =>
        layer.id === targetLayer.id
          ? {
              ...layer,
              strokes: [...strokes]
            }
          : layer
      );
      return {
        ...shot,
        activeLayerTarget: "sketch",
        activeSketchLayerId: targetLayer.id,
        sketchLayers: nextLayers
      };
    }),
    updatedAt: now()
  };
};

export const clearSketch = (project: Project, shotId: string, layerId?: string): Project => {
  return updateSketch(project, shotId, [], layerId);
};

export const appendSketchStroke = (
  project: Project,
  shotId: string,
  layerId: string,
  stroke: SketchStroke
): Project => {
  const shot = project.shots.find((item) => item.id === shotId);
  const layer = shot ? sketchLayersForShot(shot).find((item) => item.id === layerId) : undefined;

  if (!layer) {
    return project;
  }

  return updateSketch(project, shotId, [...layer.strokes, stroke], layer.id);
};

export const addSketchLayer = (project: Project, shotId: string, name = "Layer"): Project => {
  return updateShotLayers(project, shotId, (shot, layers) => {
    const nextOrder = layers.length;
    const nextLayer: SketchLayer = {
      id: `layer-${shotId}-${nextOrder}`,
      name,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      order: nextOrder,
      strokes: []
    };
    const nextLayers = normalizeSketchLayerOrder([...layers, nextLayer]);

    return {
      layers: nextLayers,
      activeSketchLayerId: nextLayer.id,
      activeLayerTarget: "sketch"
    };
  });
};

export const removeSketchLayer = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateShotLayers(project, shotId, (shot, layers) => {
    if (layers.length <= 1) {
      return { layers, activeSketchLayerId: layers[0]?.id };
    }

    const nextLayers = normalizeSketchLayerOrder(layers.filter((layer) => layer.id !== layerId));
    if (nextLayers.length === layers.length) {
      return { layers, activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id };
    }

    const activeSketchLayerId =
      shot.activeSketchLayerId === layerId
        ? nextLayers[
            Math.max(
              0,
              Math.min(layers.findIndex((layer) => layer.id === layerId), nextLayers.length - 1)
            )
          ]?.id
        : shot.activeSketchLayerId ?? nextLayers[0]?.id;

    return { layers: nextLayers, activeSketchLayerId };
  });
};

export const selectSketchLayer = (
  project: Project,
  shotId: string,
  layerId: string
): Project => {
  return updateShotLayers(project, shotId, (shot, layers) => {
    const targetLayer = layers.find((layer) => layer.id === layerId);
    return {
      layers,
      activeSketchLayerId: targetLayer ? targetLayer.id : shot.activeSketchLayerId ?? layers[0]?.id,
      activeLayerTarget: targetLayer ? "sketch" : shot.activeLayerTarget ?? "sketch"
    };
  });
};

export const updateSketchLayer = (
  project: Project,
  shotId: string,
  layerId: string,
  patch: Partial<Pick<SketchLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
): Project => {
  return updateShotLayers(project, shotId, (shot, layers) => ({
    layers: layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            name: patch.name ?? layer.name,
            visible: patch.visible ?? layer.visible,
            locked: patch.locked ?? layer.locked,
            opacity:
              patch.opacity === undefined ? layer.opacity : Math.min(1, Math.max(0, patch.opacity)),
            blendMode: patch.blendMode ?? layer.blendMode ?? "normal"
          }
        : layer
    ),
    activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id
  }));
};

export const reorderSketchLayer = (
  project: Project,
  shotId: string,
  layerId: string,
  direction: "up" | "down"
): Project => {
  return updateShotLayers(project, shotId, (shot, layers) => {
    const currentIndex = layers.findIndex((layer) => layer.id === layerId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= layers.length) {
      return { layers, activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id };
    }

    const nextLayers = [...layers];
    const [moved] = nextLayers.splice(currentIndex, 1);
    nextLayers.splice(targetIndex, 0, moved);

    return {
      layers: normalizeSketchLayerOrder(nextLayers),
      activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id
    };
  });
};

export const moveSketchLayer = (
  project: Project,
  shotId: string,
  layerId: string,
  targetLayerId: string
): Project => {
  if (layerId === targetLayerId) {
    return project;
  }

  return updateShotLayers(project, shotId, (shot, layers) => {
    const fromIndex = layers.findIndex((layer) => layer.id === layerId);
    const targetIndex = layers.findIndex((layer) => layer.id === targetLayerId);

    if (fromIndex === -1 || targetIndex === -1) {
      return { layers, activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id };
    }

    const nextLayers = [...layers];
    const [movedLayer] = nextLayers.splice(fromIndex, 1);
    const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    nextLayers.splice(adjustedTargetIndex, 0, movedLayer);

    return {
      layers: normalizeSketchLayerOrder(nextLayers),
      activeSketchLayerId: shot.activeSketchLayerId ?? layers[0]?.id
    };
  });
};

export const updateShotBaseVisibility = (
  project: Project,
  shotId: string,
  visible: boolean
): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId ? { ...shot, baseVisible: visible } : shot
    ),
    updatedAt: now()
  };
};

export const selectImageLayer = (project: Project, shotId: string): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId ? { ...shot, activeLayerTarget: "image" } : shot
    ),
    updatedAt: now()
  };
};

export const appendImageLayerEdit = (
  project: Project,
  shotId: string,
  stroke: SketchStroke
): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId
        ? {
            ...shot,
            activeLayerTarget: "image",
            imageLayerEdits: [...(shot.imageLayerEdits ?? []), stroke]
          }
        : shot
    ),
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
    const target = layers.find((layer) => layer.id === layerId);

    return {
      layers,
      activeLayerId: target?.id ?? shot.activeLayerId ?? layers[0]?.id
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
            name: patch.name ?? layer.name,
            visible: patch.visible ?? layer.visible,
            locked: patch.locked ?? layer.locked,
            opacity:
              patch.opacity === undefined ? layer.opacity : Math.min(1, Math.max(0, patch.opacity)),
            blendMode: patch.blendMode ?? layer.blendMode
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

export const clearImageLayerEdits = (project: Project, shotId: string): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId ? { ...shot, imageLayerEdits: [] } : shot
    ),
    updatedAt: now()
  };
};

export const deleteImageLayerContent = (project: Project, shotId: string): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId
        ? {
            ...shot,
            activeLayerTarget: "image",
            baseVisible: false,
            imageLayerEdits: []
          }
        : shot
    ),
    updatedAt: now()
  };
};

export const createRenamePlan = (
  project: Project,
  options: RenamePlanOptions = {}
): RenamePlanItem[] => {
  const namingPrefix = saveFilePrefix(project, options);

  return sortedShots(project.shots).map((shot, index) => {
    const finalFileName = orderedFileName(namingPrefix, shot.fileName, index);
    const directory = dirname(shot.imagePath);
    return {
      shotId: shot.id,
      fromPath: shot.imagePath,
      temporaryPath: joinPath(directory, `.storyboard-renaming-${shot.id}${extension(shot.fileName)}`),
      finalPath: joinPath(directory, finalFileName),
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
  return layers.map((layer, order) => ({
    ...layer,
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
    opacity: layer.opacity ?? 1,
    blendMode: layer.blendMode ?? "normal",
    order
  }));
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
      activeLayerId: result.activeLayerId ?? shot.activeLayerId ?? nextLayers[0]?.id
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

const updateShotLayers = (
  project: Project,
  shotId: string,
  update: (
    shot: Shot,
    layers: SketchLayer[]
  ) => { layers: SketchLayer[]; activeSketchLayerId?: string; activeLayerTarget?: "image" | "sketch" }
): Project => {
  let didChange = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== shotId) {
      return shot;
    }

    const currentLayers = sketchLayersForShot(shot);
    const result = update(shot, currentLayers);
    const nextLayers = normalizeSketchLayerOrder(result.layers);
    didChange = true;

    return {
      ...shot,
      activeLayerTarget: result.activeLayerTarget ?? shot.activeLayerTarget ?? "sketch",
      activeSketchLayerId:
        result.activeSketchLayerId ?? shot.activeSketchLayerId ?? nextLayers[0]?.id,
      sketchLayers: nextLayers
    };
  });

  return didChange ? { ...project, shots, updatedAt: now() } : project;
};

export const projectNeedsSwbImport = (project: Project): boolean => {
  return project.shots.some((shot) => shot.swb?.status === "non-swb");
};

export const projectHasSwbWarning = (project: Project): boolean => {
  return project.shots.some(
    (shot) =>
      shot.swb?.status === "non-swb" || shot.swb?.status === "incompatible-external-edit"
  );
};

export const projectAcceptedExternalEdits = (project: Project): boolean => {
  return project.shots.some((shot) => Boolean(shot.swb?.acceptedExternalEditAt));
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
    layers: [createImageBitmapLayer(shotId, width, height)],
    swb: swbStateForImportedImage(image)
  };
};

const swbStateForImportedImage = (image: ImportedImage): ShotSwbState => {
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
    statusMessage: "Import to convert this image into Storyboard Workbench Format"
  };
};

const mergedSwbState = (shot: Shot, image: ImportedImage): ShotSwbState => {
  const existing = shot.swb;
  const metadata = image.swbMetadata;

  if (!existing || existing.status === "non-swb") {
    return swbStateForImportedImage(image);
  }

  if (!metadata) {
    return {
      ...existing,
      status: "incompatible-external-edit",
      statusMessage: "SWB metadata is missing from this TIFF"
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
      statusMessage: "TIFF dimensions changed outside Storyboard Workbench"
    };
  }

  if (image.fingerprint && existing.baseFingerprint && image.fingerprint !== existing.baseFingerprint) {
    return {
      ...existing,
      status: "owned",
      baseFingerprint: image.fingerprint,
      acceptedExternalEditAt: now(),
      statusMessage: "External TIFF edits accepted as the new base image"
    };
  }

  return {
    ...existing,
    status: "owned",
    baseFingerprint: image.fingerprint ?? existing.baseFingerprint,
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
