type FlowState = {
  status?: "owned" | "non-flow" | "compatible-external-edit" | "incompatible-external-edit";
  canvasWidth?: number;
  canvasHeight?: number;
  baseFingerprint?: string;
};

type KnownImageShot = {
  id: string;
  flow?: FlowState;
};

type FlowMetadata = {
  shotId?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  baseFingerprint?: string;
};

export const knownImageHasExternalChange = (
  shot: KnownImageShot | undefined,
  fingerprint: string,
  metadata: FlowMetadata | undefined
): boolean => {
  if (!shot?.flow || shot.flow.status === "non-flow") {
    return false;
  }

  const savedFingerprint = shot.flow.baseFingerprint ?? metadata?.baseFingerprint;
  const metadataMismatch =
    metadata !== undefined &&
    (metadata.shotId !== shot.id ||
      metadata.canvasWidth !== shot.flow.canvasWidth ||
      metadata.canvasHeight !== shot.flow.canvasHeight);

  if (!savedFingerprint) {
    return metadataMismatch;
  }

  if (savedFingerprint && fingerprint === savedFingerprint) {
    return (
      shot.flow.status === "compatible-external-edit" ||
      shot.flow.status === "incompatible-external-edit"
    );
  }

  return (
    fingerprint !== savedFingerprint ||
    metadataMismatch
  );
};
