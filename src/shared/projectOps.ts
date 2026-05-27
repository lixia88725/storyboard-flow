import type {
  Dialogue,
  ImportedImage,
  Project,
  RenamePlanItem,
  RenamePreflightResult,
  Shot,
  SketchStroke
} from "./types";

export type ShotPlacement = "before" | "after";
export type StoryboardDirection = "left" | "right" | "up" | "down";

const now = () => new Date().toISOString();

export const createProject = (name = "Untitled Storyboard"): Project => {
  const timestamp = now();

  return {
    id: crypto.randomUUID(),
    name,
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
    .map((image, index) => ({
      id: crypto.randomUUID(),
      imagePath: image.imagePath,
      previewPath: image.previewPath,
      fileName: image.fileName,
      order: project.shots.length + index,
      sketchData: []
    }));

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
  const newShot: Shot = {
    id: crypto.randomUUID(),
    imagePath: image.imagePath,
    previewPath: image.previewPath,
    fileName: image.fileName,
    sourceFileName: image.fileName,
    order: insertIndex,
    sketchData: []
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
        fileName: scanned?.fileName ?? shot.fileName
      };
    });
  const keptPaths = new Set(keptShots.map((shot) => shot.imagePath));
  const newShots = images
    .filter((image) => !keptPaths.has(image.imagePath))
    .map((image, index) => ({
      id: crypto.randomUUID(),
      imagePath: image.imagePath,
      previewPath: image.previewPath,
      fileName: image.fileName,
      order: keptShots.length + index,
      sketchData: []
    }));
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
  sketchData: SketchStroke[]
): Project => {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId ? { ...shot, sketchData: [...sketchData] } : shot
    ),
    updatedAt: now()
  };
};

export const clearSketch = (project: Project, shotId: string): Project => {
  return updateSketch(project, shotId, []);
};

export const createRenamePlan = (project: Project): RenamePlanItem[] => {
  return sortedShots(project.shots).map((shot, index) => {
    const finalFileName = orderedFileName(shot.sourceFileName ?? shot.fileName, index);
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

const orderedFileName = (fileName: string, index: number): string => {
  const ext = extension(fileName);
  const baseName = stripExtension(stripOrderPrefix(fileName));
  return `${String(index + 1).padStart(3, "0")}_${baseName}${ext}`;
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
