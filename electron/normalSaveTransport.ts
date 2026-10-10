export type NormalSaveOpenOptions = { normalSave?: boolean; recoverPending?: boolean; initializePreviews?: boolean };

/** Type-only contract shared by main, both preload declarations and renderer. */
export type NormalSaveOutputAck = {
  shotId: string;
  capturedToken?: string;
  sourcePath: string;
  targetPath: string;
  outputHash: string;
  fileName?: string;
  baseFingerprint?: string;
};
/** Only an actual Trash completion plus required persistence/cleanup may emit this. */
export type NormalSaveDeletionAck = { shotId: string; sourcePath: string };
export type NormalSaveCompletion = { outputs: NormalSaveOutputAck[]; deletions: NormalSaveDeletionAck[] };
export type NormalSaveImportEffect = {
  sourceShotId: string;
  shotId: string;
  sourcePath: string;
  sourceHash: string;
  targetPath: string;
  outputHash: string;
  kind: "converted" | "accepted" | "preserved";
};
export type NormalSaveTransport = {
  /** Frozen actual external input; image required persistence retains it until script completion. */
  normalSaveScriptInput?: string;
  normalSaveScriptPlan?: import("./main/storyboardScript.js").StoryboardScriptImportPlanItem[];
  normalSaveScriptExpectedInput?: string | null;
  normalSaveAutoImageImport?: boolean;
  normalSaveImageImport?: boolean;
  normalSaveImportEffects?: NormalSaveImportEffect[];
  normalSave?: boolean;
  normalSaveOutputs?: NormalSaveOutputAck[];
  normalSaveDeletions?: NormalSaveDeletionAck[];
};
