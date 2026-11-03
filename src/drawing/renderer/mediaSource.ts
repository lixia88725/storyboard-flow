import { createContext, useContext } from 'react';
/** Images are read-only presentation. The editor owner decides how assets are resolved. */
export type MediaSource = {
  assetUrl: (filePath: string) => string;
  layerAssetUrl: (payload: { folderPath: string; bitmapPath: string; revision?: number | string }) => string;
};
export const MediaSourceContext = createContext<MediaSource | null>(null);
export const useMediaSource = (): MediaSource => {
  const media = useContext(MediaSourceContext);
  if (!media) throw new Error('MediaSourceContext is required');
  return media;
};
