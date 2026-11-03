import { useCallback, useEffect, useRef, useState } from "react";
import { createProject } from "../shared/projectOps";
import type { Project } from "../shared/types";

export type WorkspaceSaveState = "saved" | "saving" | "error";
export type FileNameSyncState = "synced" | "unsynced";
export type WorkspaceTask = {
  kind: "save" | "import" | "open";
  label: string;
  current: number;
  total: number;
};

export type WorkspaceLifecycleInitialState = {
  project: Project;
  folderPath: string | undefined;
  folderInputValue: string;
  metadataPath: string | undefined;
  workspaceSaveState: WorkspaceSaveState;
  workspaceTask: WorkspaceTask | undefined;
  fileNameSyncState: FileNameSyncState;
  recentFolders: string[];
  autosaveRevision: number;
};

export const initialWorkspaceLifecycleState = (): WorkspaceLifecycleInitialState => ({
  project: createProject("Untitled Storyboard"),
  folderPath: undefined,
  folderInputValue: "",
  metadataPath: undefined,
  workspaceSaveState: "saved",
  workspaceTask: undefined,
  fileNameSyncState: "synced",
  recentFolders: [],
  autosaveRevision: 0
});

export const publishWorkspaceProject = (
  projectRef: { current: Project },
  setProjectState: (project: Project) => void,
  update: Project | ((project: Project) => Project)
): void => {
  const next = typeof update === "function" ? update(projectRef.current) : update;
  projectRef.current = next;
  setProjectState(next);
};

export const useWorkspaceLifecycleState = () => {
  const [initialState] = useState(() => initialWorkspaceLifecycleState());
  const [project, setProjectState] = useState<Project>(initialState.project);
  const [folderPath, setFolderPath] = useState<string | undefined>(initialState.folderPath);
  const [folderInputValue, setFolderInputValue] = useState(initialState.folderInputValue);
  const [metadataPath, setMetadataPath] = useState<string | undefined>(initialState.metadataPath);
  const [workspaceSaveState, setWorkspaceSaveState] =
    useState<WorkspaceSaveState>(initialState.workspaceSaveState);
  const [workspaceTask, setWorkspaceTask] = useState<WorkspaceTask | undefined>(
    initialState.workspaceTask
  );
  const [fileNameSyncState, setFileNameSyncState] =
    useState<FileNameSyncState>(initialState.fileNameSyncState);
  const [recentFolders, setRecentFolders] = useState<string[]>(initialState.recentFolders);
  const [autosaveRevision, setAutosaveRevision] = useState(initialState.autosaveRevision);

  const projectRef = useRef(project);
  const folderPathRef = useRef(folderPath);
  const metadataPathRef = useRef(metadataPath);
  const workspaceSaveStateRef = useRef<WorkspaceSaveState>(workspaceSaveState);
  const fileNameSyncStateRef = useRef<FileNameSyncState>(fileNameSyncState);

  // Setter is the Project owner publication point. No delayed project effect may
  // reconcile an old render over a newer synchronous edit or ACK.
  const setProject = useCallback((update: Project | ((project: Project) => Project)) => {
    publishWorkspaceProject(projectRef, setProjectState, update);
  }, []);

  useEffect(() => {
    folderPathRef.current = folderPath;
  }, [folderPath]);

  useEffect(() => {
    metadataPathRef.current = metadataPath;
  }, [metadataPath]);

  useEffect(() => {
    workspaceSaveStateRef.current = workspaceSaveState;
  }, [workspaceSaveState]);

  useEffect(() => {
    fileNameSyncStateRef.current = fileNameSyncState;
  }, [fileNameSyncState]);

  return {
    project,
    setProject,
    projectRef,
    folderPath,
    setFolderPath,
    folderPathRef,
    folderInputValue,
    setFolderInputValue,
    metadataPath,
    setMetadataPath,
    metadataPathRef,
    workspaceSaveState,
    setWorkspaceSaveState,
    workspaceSaveStateRef,
    workspaceTask,
    setWorkspaceTask,
    fileNameSyncState,
    setFileNameSyncState,
    fileNameSyncStateRef,
    recentFolders,
    setRecentFolders,
    autosaveRevision,
    setAutosaveRevision
  };
};
