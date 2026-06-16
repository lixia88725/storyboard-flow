import { respondToStoryboardImageRequest } from "./appShellService.js";

export type StoryboardImageProtocolRequest = {
  url: string;
};

export type StoryboardImageProtocolOptions = {
  fetchFileUrl: (url: string) => Promise<Response>;
};

export const createStoryboardImageProtocolHandler =
  ({ fetchFileUrl }: StoryboardImageProtocolOptions) =>
  (request: StoryboardImageProtocolRequest): Promise<Response> =>
    respondToStoryboardImageRequest(request.url, fetchFileUrl);
