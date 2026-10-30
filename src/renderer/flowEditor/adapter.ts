import type { ProjectV1 } from '../../../electron/shared/refactorV1';
import type { Shot, SketchStroke } from '../../shared/types';
import type { FlowStroke } from '../../../electron/shared/flowWave2';
/** Read-only projection for existing presentation components; never a second writable Project. */
export function projectShots(project: ProjectV1, selectedLayer: Record<string, string>): Shot[] {
  return [...project.shots, ...project.parkedShots].map((shot, order) => {
    const image = project.images[shot.imageId];
    return { id: shot.id, fileName: shot.name, scriptText: shot.scriptText, order,
      imagePath: image.layers[0]?.assetId ?? '', activeLayerId: selectedLayer[shot.id] ?? image.layers.at(-1)?.id,
      flow: { version: 1, status: 'owned', canvasWidth: image.width, canvasHeight: image.height },
      layers: image.layers.map((layer, order) => ({ ...layer, order, bitmapPath: `${shot.id}/${layer.id}/${layer.assetId}` })) };
  });
}
export function pixelStroke(stroke: SketchStroke): FlowStroke {
  // SketchPad already scales size and points into image pixels. Never scale twice.
  return { tool: stroke.tool, color: stroke.color, size: stroke.size, opacity: stroke.opacity ?? 1,
    softness: stroke.softness ?? 0, points: [...stroke.points] };
}

/** SketchPad caches a returned preview. A delayed read must not override intervening Undo. */
export async function settledStrokePreview(
  current: () => ProjectV1, shotId: string, layerId: string, assetId: string,
  read: (assetId: string) => Promise<string>
): Promise<string | undefined> {
  const url = await read(assetId);
  const project = current();
  const shot = project.shots.find(item => item.id === shotId);
  const layer = shot && project.images[shot.imageId]?.layers.find(item => item.id === layerId);
  return layer?.assetId === assetId ? url : undefined;
}
