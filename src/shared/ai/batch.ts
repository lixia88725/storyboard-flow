import { dialoguesForShot } from "../projectOps";
import type { Project, Shot } from "../types";
import type { AiSelectedReference } from "./context";

export type AiBatchResourceAssignments = Record<string, string[]>;
export type AiBatchSize = 1 | 4 | 16;

export type AiBatchGroup = {
  index: number;
  shotIds: string[];
};

export type AiBatchPanelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AiBatchPanelLayout = {
  name:
    | "1-up"
    | "2-up-horizontal"
    | "3-up-horizontal"
    | "4-up-grid"
    | "6-up-grid"
    | "9-up-grid"
    | "12-up-grid"
    | "16-up-grid";
  description: string;
  columns: number;
  rows: number;
  rects: AiBatchPanelRect[];
};

export type AiBatchPromptInput = {
  project: Project;
  shotIds: string[];
  references?: AiSelectedReference[];
  resourceAssignments?: AiBatchResourceAssignments;
};

export type AiBatchResourceIdsForGroupInput = {
  shotIds: string[];
  selectedResourceIds: string[];
  resourceAssignments?: AiBatchResourceAssignments;
};

export const defaultAiBatchSize: AiBatchSize = 4;

export const normalizeAiBatchSize = (value: unknown): AiBatchSize =>
  value === 1 || value === 4 || value === 16 ? value : defaultAiBatchSize;

export const orderedAiBatchShots = (project: Project, shotIds: string[]): Shot[] => {
  const selected = new Set(shotIds);
  return project.shots.filter((shot) => selected.has(shot.id)).sort((a, b) => a.order - b.order);
};

export const groupAiBatchShotIds = (
  project: Project,
  shotIds: string[],
  batchSize: AiBatchSize = defaultAiBatchSize
): AiBatchGroup[] => {
  const orderedShotIds = orderedAiBatchShots(project, shotIds).map((shot) => shot.id);
  const groups: AiBatchGroup[] = [];
  for (let index = 0; index < orderedShotIds.length; index += batchSize) {
    groups.push({
      index: groups.length,
      shotIds: orderedShotIds.slice(index, index + batchSize)
    });
  }
  return groups;
};

export const summarizeAiBatchGroups = (shotCount: number, groups: AiBatchGroup[]): string =>
  `${shotCount} shots -> ${groups.length} generation${groups.length === 1 ? "" : "s"}: ${groups
    .map((group) => group.shotIds.length)
    .join(", ")}`;

export const aiBatchResourceIdsForGroup = ({
  shotIds,
  selectedResourceIds,
  resourceAssignments = {}
}: AiBatchResourceIdsForGroupInput): string[] => {
  const selected = new Set(selectedResourceIds);
  const result = new Set<string>();
  for (const shotId of shotIds) {
    if (!Object.prototype.hasOwnProperty.call(resourceAssignments, shotId)) {
      selectedResourceIds.forEach((resourceId) => result.add(resourceId));
      continue;
    }
    for (const resourceId of resourceAssignments[shotId] ?? []) {
      if (selected.has(resourceId)) {
        result.add(resourceId);
      }
    }
  }
  return selectedResourceIds.filter((resourceId) => result.has(resourceId));
};

export const aiBatchPanelLayout = (panelCount: number): AiBatchPanelLayout => {
  if (panelCount === 1) {
    return {
      name: "1-up",
      description: "one full-frame panel",
      columns: 1,
      rows: 1,
      rects: [{ x: 0, y: 0, width: 1, height: 1 }]
    };
  }
  if (panelCount === 2) {
    return {
      name: "2-up-horizontal",
      description: "two equal horizontal panels, left to right",
      columns: 2,
      rows: 1,
      rects: [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: 1 }
      ]
    };
  }
  if (panelCount === 3) {
    return {
      name: "3-up-horizontal",
      description: "three equal horizontal panels, left to right",
      columns: 3,
      rows: 1,
      rects: [
        { x: 0, y: 0, width: 1 / 3, height: 1 },
        { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
        { x: 2 / 3, y: 0, width: 1 / 3, height: 1 }
      ]
    };
  }
  if (panelCount === 4) {
    return {
      name: "4-up-grid",
      description: "four equal panels in a 2x2 grid, reading left to right then top to bottom",
      columns: 2,
      rows: 2,
      rects: [
        { x: 0, y: 0, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
      ]
    };
  }
  if (panelCount > 4 && panelCount <= 16) {
    return aiBatchGridLayout(panelCount);
  }
  throw new Error(`Unsupported AI batch panel count: ${panelCount}`);
};

const aiBatchGridLayout = (panelCount: number): AiBatchPanelLayout => {
  const grid =
    panelCount <= 6
      ? {
          name: "6-up-grid" as const,
          columns: 3,
          rows: 2,
          description: "six equal panels in a 3x2 grid, reading left to right then top to bottom"
        }
      : panelCount <= 9
        ? {
            name: "9-up-grid" as const,
            columns: 3,
            rows: 3,
            description: "nine equal panels in a 3x3 grid, reading left to right then top to bottom"
          }
        : panelCount <= 12
          ? {
              name: "12-up-grid" as const,
              columns: 4,
              rows: 3,
              description: "twelve equal panels in a 4x3 grid, reading left to right then top to bottom"
            }
          : {
              name: "16-up-grid" as const,
              columns: 4,
              rows: 4,
              description: "sixteen equal panels in a 4x4 grid, reading left to right then top to bottom"
            };
  return {
    ...grid,
    description: `${grid.description}.`,
    rects: Array.from({ length: panelCount }, (_item, index) => ({
      x: (index % grid.columns) / grid.columns,
      y: Math.floor(index / grid.columns) / grid.rows,
      width: 1 / grid.columns,
      height: 1 / grid.rows
    }))
  };
};

const cleanAssignment = (
  shotId: string,
  selectedResourceIds: Set<string>,
  resourceAssignments: AiBatchResourceAssignments
): string[] | undefined => {
  if (!Object.prototype.hasOwnProperty.call(resourceAssignments, shotId)) {
    return undefined;
  }
  return (resourceAssignments[shotId] ?? []).filter((resourceId) => selectedResourceIds.has(resourceId));
};

const referenceLine = (reference: AiSelectedReference, index: number): string => {
  const note = reference.note.trim();
  return `Reference ${index + 1}: ${reference.role}, ${reference.fileName}.${note ? ` ${note}` : ""}`;
};

const shortReferenceLabel = (reference: AiSelectedReference): string =>
  `${reference.role} ${reference.fileName}`;

const resourceRuleForShot = (
  shotId: string,
  panelIndex: number,
  references: AiSelectedReference[],
  resourceAssignments: AiBatchResourceAssignments
): string => {
  const selectedResourceIds = new Set(references.map((reference) => reference.id));
  const assignment = cleanAssignment(shotId, selectedResourceIds, resourceAssignments) ?? references.map((reference) => reference.id);
  if (assignment.length === 0) {
    return `Panel ${panelIndex + 1} must not use any AI Resources. Use only this panel's sketch, script, dialogue, and project context.`;
  }
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  const labels = assignment
    .map((resourceId) => referenceById.get(resourceId))
    .filter((reference): reference is AiSelectedReference => Boolean(reference))
    .map(shortReferenceLabel);
  return `Panel ${panelIndex + 1} may use these AI Resources: ${labels.join(", ")}. Use only these resources if they match this panel's script, sketch, dialogue, or visible character descriptions. Do not use any other AI Resources for this panel.`;
};

export const assembleAiBatchImagePrompt = ({
  project,
  shotIds,
  references = [],
  resourceAssignments = {}
}: AiBatchPromptInput): string => {
  const shots = orderedAiBatchShots(project, shotIds);
  if (shots.length === 0) {
    throw new Error("No shots selected for AI batch generation");
  }
  const layout = aiBatchPanelLayout(shots.length);
  const sections: string[] = [
    `Generate a storyboard contact sheet with exactly ${shots.length} panel${shots.length === 1 ? "" : "s"}.`,
    `Use this exact layout: ${layout.description}.`,
    "Use the selected storyboards contact sheet as composition and sketch reference for the matching panels.",
    "Keep each panel inside its own cell. Do not merge panels across cells.",
    "Do not render dialogue text, subtitles, captions, speech bubbles, panel numbers, or labels into the image."
  ];

  const projectContext = project.ai?.projectContext?.trim();
  if (projectContext) {
    sections.push(`Project additional context:\n${projectContext}`);
  }

  if (references.length > 0) {
    sections.push(["Batch resources available:", ...references.map(referenceLine)].join("\n"));
  }

  sections.push(
    shots
      .map((shot, panelIndex) => {
        const panelSections = [`Panel ${panelIndex + 1}: ${shot.fileName}`];
        const scriptText = shot.scriptText?.trim();
        if (scriptText) {
          panelSections.push(`Script:\n${scriptText}`);
        }
        const dialogues = dialoguesForShot(project, shot.id);
        if (dialogues.length > 0) {
          panelSections.push(`Dialogue for semantic reference only:\n${dialogues.map((dialogue) => `- ${dialogue.text}`).join("\n")}`);
        }
        panelSections.push(`Resource rule:\n${resourceRuleForShot(shot.id, panelIndex, references, resourceAssignments)}`);
        return panelSections.join("\n");
      })
      .join("\n\n")
  );

  return sections.join("\n\n");
};
