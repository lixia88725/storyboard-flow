import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { Project } from "../../shared/types";
import type { AiDraftClient } from "./aiClient";
import {
  aiResourceIdsAvailableForShot,
  canCleanAiResourceExclusions,
  cleanAiResourceExclusionsProject,
  nextAiResourceAvailabilityProject,
  type AiPanelSelectionState
} from "./aiPanelState";

export type AiResource = {
  id: string;
  fileName: string;
  filePath: string;
  role: string;
  note: string;
};

type AiResourceMetadataPatch = Partial<Pick<AiResource, "role" | "note">>;

export const uniqueAiResourceIds = (resourceIds: string[]): string[] => [...new Set(resourceIds)];

export const nextAiResourcesWithMetadataPatch = (
  resources: AiResource[],
  fileName: string,
  patch: AiResourceMetadataPatch
): AiResource[] =>
  resources.map((resource) =>
    resource.fileName === fileName ? { ...resource, ...patch } : resource
  );

export const aiResourceMetadataPayload = (resources: AiResource[]) => ({
  version: 1 as const,
  resources: resources.map((resource) => ({
    fileName: resource.fileName,
    role: resource.role,
    note: resource.note
  }))
});

export const aiResourceAssignmentSelectionKey = (selection: AiPanelSelectionState): string =>
  selection.kind === "multi" ? selection.shots.map((shot) => shot.id).join("|") : "";

export const useAiResourcesController = ({
  aiClient,
  folderPath,
  isOpen,
  project,
  selection,
  onProjectChange,
  setStatus
}: {
  aiClient: AiDraftClient;
  folderPath: string;
  isOpen: boolean;
  project: Project;
  selection: AiPanelSelectionState;
  onProjectChange: (project: Project, status: string) => void;
  setStatus: (status: string) => void;
}) => {
  const [resources, setResources] = useState<AiResource[]>([]);
  const [hasLoadedResources, setHasLoadedResources] = useState(false);
  const [isResourceDropActive, setIsResourceDropActive] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);

  const resourceIds = useMemo(() => resources.map((resource) => resource.id), [resources]);
  const activeResourceIds =
    selection.kind === "ready" ? aiResourceIdsAvailableForShot(project, selection.shot.id, resourceIds) : [];
  const batchResourceAssignments = useMemo(
    () =>
      selection.kind === "multi"
        ? Object.fromEntries(
            selection.shots.map((shot) => [
              shot.id,
              aiResourceIdsAvailableForShot(project, shot.id, resourceIds)
            ])
          )
        : {},
    [project, resourceIds, selection]
  );
  const batchSelectedResourceIds = useMemo(
    () => uniqueAiResourceIds(Object.values(batchResourceAssignments).flat()),
    [batchResourceAssignments]
  );
  const projectShotKey = project.shots.map((shot) => shot.id).join("|");
  const selectionShotKey = aiResourceAssignmentSelectionKey(selection);

  useEffect(() => {
    if (selection.kind === "multi") {
      setIsAssignmentOpen(true);
    }
  }, [selection.kind, selectionShotKey]);

  useEffect(() => {
    if (!canCleanAiResourceExclusions({ isOpen, hasLoadedResources })) {
      return;
    }
    const cleanedProject = cleanAiResourceExclusionsProject(project, resourceIds);
    if (cleanedProject !== project) {
      onProjectChange(cleanedProject, "AI resource assignments updated");
    }
  }, [hasLoadedResources, isOpen, project, projectShotKey, resourceIds]);

  useEffect(() => {
    if (!isOpen) {
      setHasLoadedResources(false);
      return;
    }
    let cancelled = false;
    setHasLoadedResources(false);
    aiClient
      .listResources(folderPath)
      .then((result) => {
        if (!cancelled) {
          setResources(result.resources);
          setHasLoadedResources(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHasLoadedResources(false);
          setStatus(`Could not load AI Resources: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiClient, folderPath, isOpen]);

  const updateResource = (fileName: string, patch: AiResourceMetadataPatch) => {
    const nextResources = nextAiResourcesWithMetadataPatch(resources, fileName, patch);
    setResources(nextResources);
    void aiClient
      .updateResourceMetadata(folderPath, aiResourceMetadataPayload(nextResources))
      .catch((error) => {
        setStatus(`Could not save AI resource notes: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const importDroppedResources = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsResourceDropActive(false);
    const sourceFilePaths = Array.from(event.dataTransfer.files)
      .map((file) => aiClient.filePathForDroppedFile(file))
      .filter((filePath) => filePath.trim() !== "");
    if (sourceFilePaths.length === 0) {
      return;
    }

    try {
      const result = await aiClient.importResources(folderPath, sourceFilePaths);
      setResources(result.resources);
      setStatus(
        result.importedFileNames.length > 0
          ? `Imported ${result.importedFileNames.length} AI resource${result.importedFileNames.length === 1 ? "" : "s"}`
          : "No supported image files were dropped"
      );
    } catch (error) {
      setStatus(`Could not import AI Resources: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const deleteResource = async (resource: AiResource) => {
    try {
      const result = await aiClient.deleteResource(folderPath, resource.fileName);
      setResources(result.resources);
      const cleanedProject = cleanAiResourceExclusionsProject(project, result.resources.map((item) => item.id));
      if (cleanedProject !== project) {
        onProjectChange(cleanedProject, `Deleted AI resource: ${resource.fileName}`);
      }
      setStatus(`Deleted AI resource: ${resource.fileName}`);
    } catch (error) {
      setStatus(`Could not delete AI resource: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleResource = (resourceId: string) => {
    if (selection.kind !== "ready") {
      return;
    }
    const isAvailable = activeResourceIds.includes(resourceId);
    onProjectChange(
      nextAiResourceAvailabilityProject(project, selection.shot.id, resourceId, !isAvailable),
      "AI resource assignment updated"
    );
  };

  const toggleAssignmentResource = (shotId: string, resourceId: string) => {
    const availableResourceIds = aiResourceIdsAvailableForShot(project, shotId, resourceIds);
    const isAvailable = availableResourceIds.includes(resourceId);
    onProjectChange(
      nextAiResourceAvailabilityProject(project, shotId, resourceId, !isAvailable),
      "AI resource assignment updated"
    );
  };

  return {
    activeResourceIds,
    batchResourceAssignments,
    batchSelectedResourceIds,
    deleteResource,
    importDroppedResources,
    isAssignmentOpen,
    isResourceDropActive,
    resources,
    setIsAssignmentOpen,
    setIsResourceDropActive,
    toggleAssignmentResource,
    toggleResource,
    updateResource
  };
};
