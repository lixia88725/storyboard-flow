export type RecoveryCaptureReference = {
  format: 'v1' | 'v2';
  policyKey: string | null;
  operationId: string;
  generationId: string;
  sealDigest: string;
};

export type RecoveryCaptureNode<T> = {
  reference: RecoveryCaptureReference;
  globalPrevious: RecoveryCaptureReference | null;
  localParent: RecoveryCaptureReference | null;
  value: T;
};

// This validates ordering only. Native permissions, content, inventory and
// physical binding must be certified by the caller; no writer/ACK authority.
export const certifyRecoveryCaptureChain = <T>(nodes: readonly RecoveryCaptureNode<T>[]): RecoveryCaptureNode<T> => {
  const referenceKey = (reference: RecoveryCaptureReference): string => {
    if (!reference || Object.keys(reference).sort().join(',') !== 'format,generationId,operationId,policyKey,sealDigest'
      || !['v1', 'v2'].includes(reference.format)
      || (reference.format === 'v1' ? reference.policyKey !== null : typeof reference.policyKey !== 'string' || !/^[a-f0-9]{64}$/.test(reference.policyKey))
      || typeof reference.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(reference.operationId)
      || typeof reference.generationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(reference.generationId)
      || typeof reference.sealDigest !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sealDigest)) {
      throw new Error('Unsupported recovery capture reference');
    }
    return JSON.stringify([reference.format, reference.policyKey, reference.operationId, reference.generationId]);
  };
  const partitionKey = (reference: RecoveryCaptureReference) => JSON.stringify([reference.format, reference.policyKey]);
  if (!nodes.length) throw new Error('No certified recovery captures');
  const captures = new Map<string, RecoveryCaptureNode<T>>();
  for (const capture of nodes) {
    const key = referenceKey(capture.reference);
    if (captures.has(key)) throw new Error('Duplicate recovery capture identity');
    captures.set(key, capture);
  }
  const resolve = (reference: RecoveryCaptureReference) => {
    const capture = captures.get(referenceKey(reference));
    if (!capture || capture.reference.sealDigest !== reference.sealDigest) throw new Error('Broken recovery capture reference');
    return capture;
  };
  const successors = new Map<RecoveryCaptureNode<T>, RecoveryCaptureNode<T>>();
  const roots: RecoveryCaptureNode<T>[] = [];
  for (const capture of nodes) {
    if (capture.globalPrevious === null) roots.push(capture);
    else {
      const previous = resolve(capture.globalPrevious);
      if (successors.has(previous)) throw new Error('Forked global recovery capture chain');
      successors.set(previous, capture);
    }
    if (capture.localParent !== null) resolve(capture.localParent);
  }
  if (roots.length !== 1) throw new Error('Ambiguous global recovery capture root');
  const visited = new Set<RecoveryCaptureNode<T>>();
  const partitionTips = new Map<string, RecoveryCaptureNode<T>>();
  let cursor: RecoveryCaptureNode<T> | undefined = roots[0];
  let tip = roots[0];
  while (cursor) {
    if (visited.has(cursor)) throw new Error('Cyclic global recovery capture chain');
    visited.add(cursor);
    const partition = partitionKey(cursor.reference);
    const previousLocal = partitionTips.get(partition);
    if (previousLocal ? cursor.localParent === null || resolve(cursor.localParent) !== previousLocal : cursor.localParent !== null) {
      throw new Error('Local recovery parent is not the nearest same-partition global ancestor');
    }
    partitionTips.set(partition, cursor);
    tip = cursor;
    cursor = successors.get(cursor);
  }
  if (visited.size !== captures.size) throw new Error('Detached global recovery capture chain');
  return tip;
};
