export type LayerAssetSnapshot = {
  bitmapPath: string;
  dataUrl?: string;
};

export type LayerAssetApi = {
  readLayerPng?: (payload: { folderPath: string; bitmapPath: string }) => Promise<string | undefined>;
  writeLayerPng: (payload: {
    folderPath: string;
    bitmapPath: string;
    dataUrl: string;
  }) => Promise<{ folderPath: string; bitmapPath: string; dataUrl: string; filePath: string }>;
  deleteLayerPng: (payload: { folderPath: string; bitmapPath: string }) => Promise<{
    folderPath: string;
    bitmapPath: string;
  }>;
};

export const readLayerAssetSnapshots = async (
  api: Pick<LayerAssetApi, "readLayerPng">,
  folderPath: string,
  bitmapPaths: string[]
): Promise<LayerAssetSnapshot[]> =>
  Promise.all(
    bitmapPaths.map(async (bitmapPath) => ({
      bitmapPath,
      dataUrl: await api.readLayerPng?.({ folderPath, bitmapPath })
    }))
  );

export const restoreLayerAssetSnapshots = async (
  api: LayerAssetApi,
  folderPath: string,
  snapshots: LayerAssetSnapshot[]
) => {
  for (const snapshot of snapshots) {
    if (snapshot.dataUrl) {
      await api.writeLayerPng({
        folderPath,
        bitmapPath: snapshot.bitmapPath,
        dataUrl: snapshot.dataUrl
      });
    } else {
      await api.deleteLayerPng({
        folderPath,
        bitmapPath: snapshot.bitmapPath
      });
    }
  }
};
