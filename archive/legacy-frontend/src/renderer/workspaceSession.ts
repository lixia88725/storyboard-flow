import { deriveWorkspaceStatusPresentation } from "./workspaceStatusPresentation";

export type WorkspaceDestination = { folderPath?: string; metadataPath?: string };
export type WorkspaceDestinationSnapshot = {
  identity: object;
  folderPath: string | undefined;
  metadataPath: string | undefined;
};
export type WorkspaceSessionOwner = {
  captureEffectAdmission: () => () => boolean;
  hasUnsavedWork: () => boolean;
  readonly lastError: unknown;
};

// Renderer lifecycle only: admission remains the real owner's responsibility.
// Read live controls at execution; do not freeze recovery or replace owner epochs.
export const createWorkspaceSession = (input: {
  owner: () => WorkspaceSessionOwner | undefined;
  readRecovery: () => string | undefined;
  readDestination: () => WorkspaceDestination;
  readIdentity: () => object;
}) => ({
  captureHistory: () => {
    const admissible = input.owner()!.captureEffectAdmission();
    return () => admissible() && !input.readRecovery();
  },
  capturePainting: (render: WorkspaceDestination) => {
    const admissible = input.owner()!.captureEffectAdmission();
    return () => {
      if (!admissible()) return false;
      const live = input.readDestination();
      return live.folderPath === render.folderPath &&
        live.metadataPath === render.metadataPath && !input.readRecovery();
    };
  },
  captureDestination: (): WorkspaceDestinationSnapshot => {
    const identity = input.readIdentity();
    const live = input.readDestination();
    return { identity, folderPath: live.folderPath, metadataPath: live.metadataPath };
  },
  isCurrentDestination: (request: WorkspaceDestinationSnapshot) => {
    if (request.identity !== input.readIdentity()) return false;
    const live = input.readDestination();
    return request.folderPath === live.folderPath && request.metadataPath === live.metadataPath;
  },
  identityForRender: (render: WorkspaceDestination): object => {
    const live = input.readDestination();
    return live.folderPath === render.folderPath && live.metadataPath === render.metadataPath
      ? input.readIdentity() : {};
  },
  status: (presentation: Omit<Parameters<typeof deriveWorkspaceStatusPresentation>[0], "owner" | "recoveryRequired">) =>
    deriveWorkspaceStatusPresentation({ ...presentation, owner: input.owner(), recoveryRequired: input.readRecovery() })
});
