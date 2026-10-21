// Finite, explicit manual image Import admission; not Save/autoImport permission.
import { isCertifiedPendingBakeEntry } from "./pendingBakeRules.js";
export type ManualImportShot = { id: string; imagePath: string; layers?: unknown[]; sketchLayers?: { strokes: unknown[] }[]; imageLayerEdits?: unknown[]; swb?: { status: string } };
// Automatic refresh is not a user Import decision: no fresh, dirty, preserve or duplicate.
export const automaticImageImportAdmission = <S extends ManualImportShot>(project: { shots: S[]; parkedShots?: S[]; pendingBake?: unknown }, dirtyShotIds: string[] = []) => {
  const admitted = manualImageImportAdmission(project);
  if (!admitted.some(a => a.external) || admitted.some(a => a.fresh || a.external && (a.entry?.state !== "synced" || dirtyShotIds.includes(a.shot.id)))) {
    throw new Error("External changes conflict with local or unknown output; both versions retained, explicit Import required");
  }
  return admitted;
};
export const manualImageImportAdmission = <S extends ManualImportShot>(project: { shots: S[]; parkedShots?: S[]; pendingBake?: unknown }) => {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const raw = project.pendingBake;
  const entries = raw === undefined ? {} : record(raw) && raw.version === 1 && record(raw.shots) ? raw.shots : undefined;
  if (!entries || !Object.values(entries).every(isCertifiedPendingBakeEntry)) throw new Error("Import compatibility is unknown; internal assets and sources were preserved");
  const shots = [...project.shots, ...(project.parkedShots ?? [])];
  if (new Set(shots.map(s => s.id)).size !== shots.length) throw new Error("Ambiguous Import shot identity");
  return shots.map(shot => {
    const entry = entries[shot.id];
    // Scan metadata is not proof of an internal edit. Only the exact default Image
    // descriptor is eligible; main additionally proves that its PNG does not exist.
    const expected = {
      id: "layer-image", kind: "image", name: "Image", visible: true, locked: false, opacity: 1,
      blendMode: "normal", order: 0, bitmapPath: `.storyboard-workbench/layers/${shot.id}/layer-image.png`,
      width: (shot.swb as { canvasWidth?: number })?.canvasWidth, height: (shot.swb as { canvasHeight?: number })?.canvasHeight
    };
    const layer = shot.layers?.[0];
    const defaults = !shot.layers?.length || shot.layers.length === 1 && record(layer) &&
      Object.keys(layer).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => layer[key] === value);
    const fresh = !entry && shot.swb?.status === "non-swb" && defaults && !shot.imageLayerEdits?.length && !shot.sketchLayers?.some(l => l.strokes.length);
    if (!fresh && (!entry || !["owned", "compatible-external-edit"].includes(shot.swb?.status ?? ""))) throw new Error("Import compatibility is unknown; internal assets and sources were preserved");
    return { shot, fresh, external: shot.swb?.status === "compatible-external-edit", entry: entry as { state: "synced" | "pending"; acceptedOutputIdentity: string; editToken?: string } | undefined };
  });
};
