import { respondToStoryboardImageRequest } from "./appShellService.js";

export type StoryboardImageProtocolRequest = {
  url: string;
};

export type StoryboardImageProtocolOptions = {
  fetchFileUrl: (url: string) => Promise<Response>;
  resolveLayerAssetPath?: (folderPath: string, bitmapPath: string) => string;
};

export const createStoryboardImageProtocolHandler =
  ({ fetchFileUrl, resolveLayerAssetPath }: StoryboardImageProtocolOptions) =>
  (request: StoryboardImageProtocolRequest): Promise<Response> =>
    respondToStoryboardImageRequest(request.url, fetchFileUrl, resolveLayerAssetPath);
