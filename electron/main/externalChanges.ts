type SwbState = {
  status?: "owned" | "non-swb" | "compatible-external-edit" | "incompatible-external-edit";
  canvasWidth?: number;
  canvasHeight?: number;
  baseFingerprint?: string;
};

type KnownImageShot = {
  id: string;
  swb?: SwbState;
};

type SwbMetadata = {
  shotId?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  baseFingerprint?: string;
};

export const knownImageHasExternalChange = (
  shot: KnownImageShot | undefined,
  fingerprint: string,
  metadata: SwbMetadata | undefined
): boolean => {
  if (!shot?.swb || shot.swb.status === "non-swb") {
    return false;
  }

  const savedFingerprint = shot.swb.baseFingerprint ?? metadata?.baseFingerprint;
  const metadataMismatch =
    metadata !== undefined &&
    (metadata.shotId !== shot.id ||
      metadata.canvasWidth !== shot.swb.canvasWidth ||
      metadata.canvasHeight !== shot.swb.canvasHeight);

  if (!savedFingerprint) {
    return metadataMismatch;
  }

  if (savedFingerprint && fingerprint === savedFingerprint) {
    return (
      shot.swb.status === "compatible-external-edit" ||
      shot.swb.status === "incompatible-external-edit"
    );
  }

  return (
    fingerprint !== savedFingerprint ||
    metadataMismatch
  );
};
