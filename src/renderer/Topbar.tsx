import type { Dispatch, RefObject, SetStateAction } from "react";
import type { BlankShotPreset, Project, ProjectNaming } from "../shared/types";
import type { BoardViewMode } from "./boardViewMode";
import { JapaneseStoryboardIcon, SidePanelIcon, StoryboardGridIcon } from "./icons";
import { IMPORT_REQUIRED_HELP } from "./importRequiredHelp";
import type { WorkspaceTask } from "./workspaceLifecycleState";

const blankShotPresets: Array<{ id: BlankShotPreset; label: string; detail: string }> = [
  { id: "16:9", label: "16:9", detail: "1920 x 1080" },
  { id: "9:16", label: "9:16 Phone", detail: "1080 x 1920" },
  { id: "2.39:1", label: "2.39:1", detail: "2581 x 1080" },
  { id: "1.43:1", label: "1.43:1 IMAX", detail: "1544 x 1080" }
];

type TopbarProps = {
  addShotMenuRef: RefObject<HTMLDivElement | null>;
  blankShotPreset: BlankShotPreset;
  boardViewMode: BoardViewMode;
  folderInputValue: string;
  hasSwbWarning: boolean;
  importHelpRef: RefObject<HTMLDivElement | null>;
  isAddShotMenuOpen: boolean;
  isAiPanelVisible: boolean;
  isImportHelpOpen: boolean;
  isImportLocked: boolean;
  isImportNudging: boolean;
  isParkingShelfOpen: boolean;
  isRecentMenuOpen: boolean;
  isSaveEmphasized: boolean;
  isSaveMenuOpen: boolean;
  isWorkspaceTaskRunning: boolean;
  needsSwbImport: boolean;
  project: Project;
  recentFolders: string[];
  recentMenuRef: RefObject<HTMLDivElement | null>;
  saveMenuRef: RefObject<HTMLDivElement | null>;
  setBlankShotPreset: Dispatch<SetStateAction<BlankShotPreset>>;
  setBoardViewMode: Dispatch<SetStateAction<BoardViewMode>>;
  setFolderInputValue: Dispatch<SetStateAction<string>>;
  setIsAddShotMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportHelpOpen: Dispatch<SetStateAction<boolean>>;
  setIsRecentMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsSaveMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleAddShot: () => Promise<unknown>;
  handleImportSwbFormat: () => Promise<unknown>;
  handleOpenFolderByPath: (pathOverride?: string) => Promise<unknown>;
  handleSaveProject: () => Promise<unknown>;
  handleToggleAiPanel: () => void;
  handleTogglePendingShelf: () => void;
  nudgeImportRequired: () => void;
  updateProjectName: (name: string) => void;
  updateProjectNaming: (field: keyof ProjectNaming, value: string) => void;
  workspaceTask: WorkspaceTask | undefined;
};

export const Topbar = ({
  addShotMenuRef,
  blankShotPreset,
  boardViewMode,
  folderInputValue,
  hasSwbWarning,
  importHelpRef,
  isAddShotMenuOpen,
  isAiPanelVisible,
  isImportHelpOpen,
  isImportLocked,
  isImportNudging,
  isParkingShelfOpen,
  isRecentMenuOpen,
  isSaveEmphasized,
  isSaveMenuOpen,
  isWorkspaceTaskRunning,
  needsSwbImport,
  project,
  recentFolders,
  recentMenuRef,
  saveMenuRef,
  setBlankShotPreset,
  setBoardViewMode,
  setFolderInputValue,
  setIsAddShotMenuOpen,
  setIsImportHelpOpen,
  setIsRecentMenuOpen,
  setIsSaveMenuOpen,
  handleAddShot,
  handleImportSwbFormat,
  handleOpenFolderByPath,
  handleSaveProject,
  handleToggleAiPanel,
  handleTogglePendingShelf,
  nudgeImportRequired,
  updateProjectName,
  updateProjectNaming,
  workspaceTask
}: TopbarProps) => (
  <header className="topbar">
    <div className="import-control" ref={importHelpRef}>
      <button
        type="button"
        className={isImportNudging ? "import-button is-nudging" : "import-button"}
        onClick={() => void handleImportSwbFormat()}
        disabled={!needsSwbImport || isWorkspaceTaskRunning}
        title="Import image or storyboard-script.md changes into Storyboard Flow"
      >
        {workspaceTask?.kind === "import" ? "Importing..." : "Import"}
      </button>
      {hasSwbWarning ? (
        <button
          type="button"
          className={isImportNudging ? "import-warning is-nudging" : "import-warning"}
          aria-label="Import explanation"
          aria-expanded={isImportHelpOpen}
          onClick={() => setIsImportHelpOpen((isOpen) => !isOpen)}
        >
          !
        </button>
      ) : null}
      {isImportHelpOpen ? (
        <div className="import-help-popover" role="dialog" aria-label="Import explanation">
          <strong className="import-help-title">{IMPORT_REQUIRED_HELP.title}</strong>
          <div className="import-help-copy">
            <strong>{IMPORT_REQUIRED_HELP.heading}</strong>
            {IMPORT_REQUIRED_HELP.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      ) : null}
      <div className="save-menu-container" ref={saveMenuRef}>
        <div className={isSaveEmphasized ? "save-split-button" : "save-split-button is-save-synced"}>
          <button
            type="button"
            className="save-main-button"
            disabled={isWorkspaceTaskRunning || isImportLocked}
            onClick={() => {
              setIsSaveMenuOpen(false);
              void handleSaveProject();
            }}
          >
            {workspaceTask?.kind === "save" ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="save-menu-toggle"
            aria-label="Save naming options"
            aria-expanded={isSaveMenuOpen}
            disabled={isWorkspaceTaskRunning || isImportLocked}
            onClick={() => setIsSaveMenuOpen((isOpen) => !isOpen)}
          >
            <span className="save-caret" aria-hidden="true" />
          </button>
        </div>
        {isSaveMenuOpen ? (
          <div className="save-menu" aria-label="Save naming options">
            <label className="save-menu-field">
              <span>Project</span>
              <input
                aria-label="Project name"
                value={project.name}
                onChange={(event) => updateProjectName(event.target.value)}
                placeholder="Untitled Storyboard"
              />
            </label>
            <label className="save-menu-field">
              <span>Scene</span>
              <input
                aria-label="Scene code"
                value={project.naming?.sceneCode ?? ""}
                onChange={(event) => updateProjectNaming("sceneCode", event.target.value)}
                placeholder="scene"
              />
            </label>
            <label className="save-menu-field">
              <span>Artist</span>
              <input
                aria-label="Artist name"
                value={project.naming?.artistName ?? ""}
                onChange={(event) => updateProjectNaming("artistName", event.target.value)}
                placeholder="artist"
              />
            </label>
            <label className="save-menu-field">
              <span>Version</span>
              <input
                aria-label="Version"
                value={project.naming?.version ?? ""}
                onChange={(event) => updateProjectNaming("version", event.target.value)}
                placeholder="v001"
              />
            </label>
          </div>
        ) : null}
      </div>
      <div className="board-view-toggle" aria-label="Storyboard view mode">
        <button
          type="button"
          className={boardViewMode === "storyboard" ? "selected" : ""}
          aria-label="Show storyboard board"
          aria-pressed={boardViewMode === "storyboard"}
          title="Storyboard board"
          onClick={() => setBoardViewMode("storyboard")}
        >
          <StoryboardGridIcon />
        </button>
        <button
          type="button"
          className={boardViewMode === "japaneseStoryboard" ? "selected" : ""}
          aria-label="Show Japanese storyboard sheet"
          aria-pressed={boardViewMode === "japaneseStoryboard"}
          title="Japanese storyboard sheet"
          onClick={() => setBoardViewMode("japaneseStoryboard")}
        >
          <JapaneseStoryboardIcon />
        </button>
      </div>
    </div>
    <div className="address-bar-container" ref={recentMenuRef}>
      <div className="address-bar">
        <form
          className="path-form"
          onSubmit={(event) => {
            event.preventDefault();
            setIsRecentMenuOpen(false);
            void handleOpenFolderByPath();
          }}
        >
          <input
            aria-label="Folder path"
            value={folderInputValue}
            onChange={(event) => setFolderInputValue(event.target.value)}
            placeholder="/Users/name/Pictures/scene"
          />
        </form>
        <button
          type="button"
          className="address-recent-toggle"
          aria-label="Recent folders"
          aria-expanded={isRecentMenuOpen}
          disabled={recentFolders.length === 0}
          onClick={() => setIsRecentMenuOpen((isOpen) => !isOpen)}
        >
          <span className="address-caret" aria-hidden="true" />
        </button>
      </div>
      {isRecentMenuOpen ? (
        <div className="recent-menu" aria-label="Recent folders">
          {recentFolders.map((recentFolder) => (
            <button
              key={recentFolder}
              type="button"
              onClick={() => {
                setIsRecentMenuOpen(false);
                setFolderInputValue(recentFolder);
                void handleOpenFolderByPath(recentFolder);
              }}
            >
              {recentFolder}
            </button>
          ))}
        </div>
      ) : null}
    </div>
    <div className="toolbar">
      <button
        type="button"
        className={`ai-panel-toggle ${isAiPanelVisible ? "selected" : ""}`}
        aria-label="Toggle AI Draft panel"
        aria-expanded={isAiPanelVisible}
        title="AI Draft"
        onClick={handleToggleAiPanel}
      >
        AI
      </button>
      <div className="add-shot-menu-container" ref={addShotMenuRef}>
        <div className="add-shot-split-button">
          <button
            type="button"
            className="add-shot-main-button"
            disabled={isImportLocked}
            onClick={() => {
              if (isImportLocked) {
                nudgeImportRequired();
                return;
              }
              setIsAddShotMenuOpen(false);
              void handleAddShot();
            }}
          >
            Add
          </button>
          <button
            type="button"
            className="add-shot-menu-toggle"
            aria-label="Add shot aspect ratio"
            aria-expanded={isAddShotMenuOpen}
            disabled={isImportLocked}
            onClick={() => setIsAddShotMenuOpen((isOpen) => !isOpen)}
          >
            <span className="add-shot-caret" aria-hidden="true" />
          </button>
        </div>
        {isAddShotMenuOpen ? (
          <div className="add-shot-menu" aria-label="Add shot aspect ratio">
            {blankShotPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={preset.id === blankShotPreset ? "is-selected" : ""}
                onClick={() => {
                  setBlankShotPreset(preset.id);
                  setIsAddShotMenuOpen(false);
                }}
              >
                <span>{preset.label}</span>
                <small>{preset.detail}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`pending-shelf-toggle ${isParkingShelfOpen ? "selected" : ""}`}
        aria-label="Toggle pending sidebar"
        aria-expanded={isParkingShelfOpen}
        title="Pending sidebar"
        onClick={handleTogglePendingShelf}
      >
        <SidePanelIcon />
      </button>
    </div>
  </header>
);
