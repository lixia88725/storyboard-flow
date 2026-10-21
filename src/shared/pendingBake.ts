import type { PendingBake, PendingBakeShot, Project } from "./types";
import { classifyPendingBakeEnvelope, isOutputHash as isHash } from "../../electron/shared/pendingBakeRules";

/** Classification is separate from the runtime view: never persist a normalized
 * unknown view over unsupported/corrupt data, including zero-shot projects. */
export const classifyPendingBake = (project: Project): "missing" | "supported" | "unsupported" | "corrupt" => {
  return classifyPendingBakeEnvelope(project.pendingBake);
};

/** Runtime view retains supported extensions; invalid raw data stays on Project. */
export const pendingBakeForProject = (project: Project): PendingBake => {
  const valid = classifyPendingBake(project) === "supported";
  const raw = valid ? project.pendingBake! : undefined;
  const shots: Record<string, PendingBakeShot> = { ...raw?.shots };
  for (const shot of [...project.shots, ...(project.parkedShots ?? [])]) {
    const entry = raw && Object.hasOwn(raw.shots, shot.id) ? raw.shots[shot.id] : undefined;
    shots[shot.id] = entry ? { ...entry } : { state: "unknown" };
  }
  return { ...raw, version: 1, shots };
};

export type { NormalSaveOutputAck } from "../../electron/normalSaveTransport";
import type { NormalSaveOutputAck } from "../../electron/normalSaveTransport";

/** Merge only certified captured-shot effects; never replace the latest Project. */
export const acknowledgeBake = (captured: Project, current: Project, acks: NormalSaveOutputAck[]): Project | undefined => {
  if ([captured, current].some(p => ["unsupported", "corrupt"].includes(classifyPendingBake(p)))) return undefined;
  const before = pendingBakeForProject(captured);
  const envelope = pendingBakeForProject(current);
  const ids = captured.shots.filter(s => before.shots[s.id].state === "pending").map(s => s.id);
  if (new Set(acks.map(a => a.shotId)).size !== acks.length || ids.some(id => !acks.some(a => a.shotId === id))) return undefined;
  const effects = new Map<string, NormalSaveOutputAck>();
  for (const ack of acks) {
    const source = captured.shots.find(s => s.id === ack.shotId);
    const target = current.shots.find(s => s.id === ack.shotId);
    const entry = envelope.shots[ack.shotId];
    const previous = before.shots[ack.shotId];
    if (!source || !target || !isHash(ack.outputHash) || !ack.targetPath ||
        (ack.targetPath !== ack.sourcePath && (!/\.tiff?$/iu.test(ack.targetPath) || ack.fileName !== ack.targetPath.split(/[\\/]/u).pop())) ||
        source.imagePath !== ack.sourcePath || target.imagePath !== ack.sourcePath ||
        previous?.state === "unknown" || previous?.editToken !== ack.capturedToken || entry?.state === "unknown" ||
        entry?.acceptedOutputIdentity !== previous?.acceptedOutputIdentity) return undefined;
    const completed = { ...entry, state: "synced" as const, acceptedOutputIdentity: ack.outputHash };
    delete completed.editToken;
    envelope.shots[ack.shotId] = entry.editToken === ack.capturedToken
      ? completed : { ...entry, acceptedOutputIdentity: ack.outputHash };
    effects.set(ack.shotId, ack);
  }
  return { ...current, pendingBake: envelope, shots: current.shots.map(shot => {
    const ack = effects.get(shot.id);
    return !ack ? shot : { ...shot, imagePath: ack.targetPath,
      ...(ack.fileName !== undefined ? { fileName: ack.fileName } : {}),
      ...(ack.baseFingerprint !== undefined && shot.swb ? { swb: { ...shot.swb, baseFingerprint: ack.baseFingerprint } } : {}) };
  }) };
};

/** Call only for an actual completed output, not an entire returned project. */
export const initializeCompletedShot = (project: Project, shotId: string, outputHash: string, token: string): Project => {
  if (!isHash(outputHash) || !token || ![...project.shots, ...(project.parkedShots ?? [])].some(s => s.id === shotId)) {
    throw new Error("Completed shot identity is invalid");
  }
  if (["unsupported", "corrupt"].includes(classifyPendingBake(project))) return project;
  const envelope = pendingBakeForProject(project);
  if (project.pendingBake?.shots[shotId]?.state === "unknown") return project;
  return { ...project, pendingBake: { ...envelope, shots: { ...envelope.shots,
    [shotId]: { state: "pending", editToken: token, acceptedOutputIdentity: outputHash } } } };
};
