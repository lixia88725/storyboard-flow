export type ElectronBitmapLayer = {
  id: string;
  kind: "image" | "paint";
  name: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: "normal" | "multiply" | "screen";
  order: number;
  bitmapPath: string;
  width: number;
  height: number;
  cleared?: boolean;
};

export const bitmapLayersForShot = <T extends { layers?: ElectronBitmapLayer[] }>(
  shot: T
): Array<ElectronBitmapLayer & {
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: "normal" | "multiply" | "screen";
}> => {
  return [...(shot.layers ?? [])]
    .sort((a, b) => {
      if (a.kind === "image" && b.kind !== "image") {
        return -1;
      }

      if (a.kind !== "image" && b.kind === "image") {
        return 1;
      }

      return a.order - b.order;
    })
    .map((layer, order) => ({
      ...layer,
      order,
      visible: layer.visible ?? true,
      locked: layer.locked ?? false,
      opacity: layer.opacity ?? 1,
      blendMode: layer.blendMode ?? "normal"
    }));
};
