import { createHash } from 'node:crypto';
import type { startImageEngine } from './imageEngineConnection.js';
import type { NativeProjectSession } from '../../session/core/nativeSession.js';
import { validNativeImageRef } from '../../session/core/imageProjectModel.js';

export type NativeOutputFormat = 'psd' | 'tiff';
const refuse = (message: string) => Object.assign(Error(message), { code: 'output-capture-refused', effect: 'none' as const });

/** Main-private output capture. The Session, not a renderer-provided project,
 * supplies the frozen revision. This returns verified bytes, never publishes a
 * user file or marks Save complete. Publication remains a separate transaction.
 */
export async function captureImageEngineOutput(options: {
  session: Pick<NativeProjectSession, 'snapshot'>;
  connection: ReturnType<typeof startImageEngine>;
  imageId: string;
  operationId: string;
  format: NativeOutputFormat;
  maxBytes?: number;
}) {
  const { session, connection, imageId, operationId, format } = options;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!['psd', 'tiff'].includes(format) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024)
    throw refuse('Invalid output format or byte budget');
  const before = structuredClone(session.snapshot());
  const content = before.project.images[imageId]?.content;
  if (before.phase !== 'frozen' || before.pending !== 0 || before.recovery || content?.kind !== 'native' || !validNativeImageRef(content.native))
    throw refuse('Output requires a settled frozen native image');
  if (!connection.supports('immutableVersionExportV1')) throw refuse('Native component does not support immutable version export');
  const ref = content.native;
  const result = await connection.request(operationId, { kind: 'export', versionId: ref.versionId, format, maxBytes }, ref.versionId);
  const reply = result.header.body;
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw refuse('Invalid native output receipt');
  const r = reply as Record<string, unknown>;
  if (r.kind === 'failure') throw refuse('Native output refused: ' + JSON.stringify(r.error));
  const bytes = new Uint8Array(result.payload);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const signature = Buffer.from(bytes.subarray(0, 4)).toString('hex');
  if (r.kind !== 'exported' || r.documentId !== ref.documentId || r.versionId !== ref.versionId || r.format !== format ||
      r.width !== ref.width || r.height !== ref.height || r.byteLength !== bytes.byteLength || !bytes.byteLength || bytes.byteLength > maxBytes ||
      r.sha256 !== digest || r.layered !== true || !Number.isSafeInteger(r.layerCount) || Number(r.layerCount) < 1 ||
      !Array.isArray(r.warnings) || r.warnings.length !== 0 ||
      (format === 'psd' ? signature !== '38425053' : !['49492a00', '4d4d002a'].includes(signature)))
    throw refuse('Native output bytes do not match the frozen image receipt');
  const after = session.snapshot();
  if (after.phase !== 'frozen' || after.pending !== 0 || after.recovery || after.sessionId !== before.sessionId || after.incarnation !== before.incarnation ||
      after.project.id !== before.project.id || after.project.revision !== before.project.revision ||
      JSON.stringify(after.project.images[imageId]?.content) !== JSON.stringify(content))
    throw refuse('Project changed while capturing output');
  return { projectId: before.project.id, revision: before.project.revision, imageId, native: { ...ref },
    format, bytes, sha256: digest, layerCount: Number(r.layerCount) };
}
