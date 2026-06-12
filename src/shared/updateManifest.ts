export type UpdateDownloadKey = "windowsPortable" | "macosAppleSilicon" | "macosIntel";

export type UpdateManifest = {
  latest: string;
  notes?: string;
  releaseUrl: string;
  downloads: Partial<Record<UpdateDownloadKey, string>>;
};

export type AvailableUpdate = {
  version: string;
  notes?: string;
  releaseUrl: string;
  downloadUrl: string;
};

export const cacheBustedUpdateManifestUrl = (url: string, cacheKey: string | number): string => {
  try {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("_", String(cacheKey));
    return nextUrl.toString();
  } catch {
    return url;
  }
};

export const isVersionGreater = (candidate: string, current: string): boolean => {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) {
    return false;
  }

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] > currentParts[index]) {
      return true;
    }
    if (candidateParts[index] < currentParts[index]) {
      return false;
    }
  }

  return false;
};

export const currentPlatformDownloadKey = (
  platform: NodeJS.Platform | string,
  arch: NodeJS.Architecture | string
): UpdateDownloadKey | undefined => {
  if (platform === "win32") {
    return "windowsPortable";
  }
  if (platform === "darwin") {
    return arch === "x64" ? "macosIntel" : "macosAppleSilicon";
  }
  return undefined;
};

export const parseUpdateManifest = (value: unknown): UpdateManifest | undefined => {
  if (!isRecord(value) || typeof value.latest !== "string" || typeof value.releaseUrl !== "string") {
    return undefined;
  }
  if (!isRecord(value.downloads)) {
    return undefined;
  }

  const downloads: Partial<Record<UpdateDownloadKey, string>> = {};
  for (const key of ["windowsPortable", "macosAppleSilicon", "macosIntel"] as const) {
    const downloadUrl = value.downloads[key];
    if (typeof downloadUrl === "string") {
      downloads[key] = downloadUrl;
    }
  }

  return {
    latest: value.latest,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    releaseUrl: value.releaseUrl,
    downloads
  };
};

export const findAvailableUpdate = ({
  currentVersion,
  platform,
  arch,
  manifest
}: {
  currentVersion: string;
  platform: NodeJS.Platform | string;
  arch: NodeJS.Architecture | string;
  manifest: UpdateManifest;
}): AvailableUpdate | undefined => {
  if (!isVersionGreater(manifest.latest, currentVersion)) {
    return undefined;
  }

  const downloadKey = currentPlatformDownloadKey(platform, arch);
  const downloadUrl = downloadKey ? manifest.downloads[downloadKey] : undefined;
  if (!downloadUrl) {
    return undefined;
  }

  return {
    version: manifest.latest,
    notes: manifest.notes,
    releaseUrl: manifest.releaseUrl,
    downloadUrl
  };
};

const parseVersion = (version: string): [number, number, number] | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
