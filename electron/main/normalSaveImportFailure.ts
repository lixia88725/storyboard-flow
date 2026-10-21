import { normalSaveImportFailure as plainImportFailure } from "../shared/normalSaveImportIpc.js";
import { workspaceEffectFailure } from "./workspaceEffectFailure.js";

// Main-only classifier: preserve typed paths without importing Node classes in renderer.
export const normalSaveImportFailure = (error: unknown) => {
  const facts = workspaceEffectFailure(error, "save").error;
  return plainImportFailure({ message: facts.message }, facts.retainedPaths);
};
