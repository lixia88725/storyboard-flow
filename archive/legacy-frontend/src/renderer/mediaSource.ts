import { createContext, useContext } from 'react';
/** Images are read-only presentation. The editor owner decides how assets are resolved. */
export type MediaSource = Pick<Window['storyboard'], 'assetUrl' | 'layerAssetUrl'>;
export const MediaSourceContext = createContext<MediaSource | null>(null);
export const useMediaSource = (): MediaSource => useContext(MediaSourceContext) ?? window.storyboard;
