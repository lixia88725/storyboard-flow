import type { DragEvent } from "react";
import { CloseIcon } from "../icons";
import type { AiPanelSelectionState } from "./aiPanelState";
import type { AiResource } from "./useAiResourcesController";

type AiResourcesSectionProps = {
  activeResourceIds: string[];
  assetUrl: (filePath: string) => string;
  batchResourceAssignments: Record<string, string[]>;
  isAssignmentOpen: boolean;
  isResourceDropActive: boolean;
  referenceRoles: string[];
  resources: AiResource[];
  selection: AiPanelSelectionState;
  shotNumberLabel: (shotId: string) => string;
  deleteResource: (resource: AiResource) => void;
  importDroppedResources: (event: DragEvent<HTMLElement>) => void;
  setIsAssignmentOpen: (updater: (isOpen: boolean) => boolean) => void;
  setIsResourceDropActive: (isActive: boolean) => void;
  toggleAssignmentResource: (shotId: string, resourceId: string) => void;
  toggleResource: (resourceId: string) => void;
  updateResource: (fileName: string, patch: Partial<Pick<AiResource, "role" | "note">>) => void;
};

export const aiResourceEmptyMessage = (): string =>
  "Drop reference images here to add them to AI Resources.";

export const aiResourceAssignmentEmptyMessage = (): string =>
  "Drop reference images into AI Resources from a single shot.";

export const aiResourceReferenceCountLabel = (
  availableCount: number,
  totalCount: number
): string => `${availableCount} / ${totalCount} references`;

export const AiResourcesSection = ({
  activeResourceIds,
  assetUrl,
  batchResourceAssignments,
  isAssignmentOpen,
  isResourceDropActive,
  referenceRoles,
  resources,
  selection,
  shotNumberLabel,
  deleteResource,
  importDroppedResources,
  setIsAssignmentOpen,
  setIsResourceDropActive,
  toggleAssignmentResource,
  toggleResource,
  updateResource
}: AiResourcesSectionProps) => (
  <>
    {selection.kind === "ready" ? (
      <section
        className={`ai-panel-section ai-resources-section ${isResourceDropActive ? "is-drop-active" : ""}`}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setIsResourceDropActive(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsResourceDropActive(true);
          }
        }}
        onDragLeave={() => setIsResourceDropActive(false)}
        onDrop={(event) => importDroppedResources(event)}
      >
        <h3>AI Resources</h3>
        {resources.length === 0 ? (
          <p className="ai-empty-state">{aiResourceEmptyMessage()}</p>
        ) : (
          <div className="ai-resource-list">
            {resources.map((resource) => (
              <article key={resource.id} className="ai-resource-card">
                <button
                  type="button"
                  className="ai-resource-delete"
                  aria-label={`Delete ${resource.fileName}`}
                  title="Delete resource"
                  onClick={() => deleteResource(resource)}
                >
                  <CloseIcon />
                </button>
                <label className="ai-resource-select">
                  <input
                    type="checkbox"
                    checked={activeResourceIds.includes(resource.id)}
                    onChange={() => toggleResource(resource.id)}
                  />
                  <img src={assetUrl(resource.filePath)} alt="" />
                  <span>{resource.fileName}</span>
                </label>
                <div className="ai-resource-details">
                  <select
                    value={resource.role}
                    onChange={(event) => updateResource(resource.fileName, { role: event.target.value })}
                  >
                    {referenceRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={resource.note}
                    onChange={(event) => updateResource(resource.fileName, { note: event.target.value })}
                    placeholder="How should the model use this image?"
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    ) : null}

    {selection.kind === "multi" ? (
      <section className="ai-resource-assignment">
        <button
          type="button"
          className="ai-assignment-toggle"
          aria-expanded={isAssignmentOpen}
          onClick={() => setIsAssignmentOpen((isOpen) => !isOpen)}
        >
          <span>Shot Resource Assignment</span>
          <span
            className={`ai-assignment-toggle-icon ${isAssignmentOpen ? "is-open" : ""}`}
            aria-hidden="true"
          />
        </button>
        {isAssignmentOpen ? (
          <div className="ai-assignment-list">
            {selection.shots.map((shot) => {
              const availableResourceIds = batchResourceAssignments[shot.id] ?? [];
              return (
                <article key={shot.id} className="ai-assignment-card">
                  <div className="ai-assignment-card-header">
                    <span>{shotNumberLabel(shot.id)}</span>
                    <span>{aiResourceReferenceCountLabel(availableResourceIds.length, resources.length)}</span>
                  </div>
                  {resources.length > 0 ? (
                    <div className="ai-assignment-resources">
                      {resources.map((resource) => (
                        <label key={resource.id}>
                          <input
                            type="checkbox"
                            checked={availableResourceIds.includes(resource.id)}
                            onChange={() => toggleAssignmentResource(shot.id, resource.id)}
                          />
                          <span>{resource.fileName}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="ai-empty-state">{aiResourceAssignmentEmptyMessage()}</p>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    ) : null}
  </>
);
