export type LayerAssetUrlPayload = {
  folderPath: string;
  bitmapPath: string;
  revision?: number | string;
};

export const buildLayerAssetUrl = ({
  folderPath,
  bitmapPath,
  revision
}: LayerAssetUrlPayload): string => {
  const query = new URLSearchParams({ folderPath, bitmapPath });
  if (revision !== undefined) {
    query.set("revision", String(revision));
  }
  return `storyboard-img://layer?${query.toString()}`;
};
