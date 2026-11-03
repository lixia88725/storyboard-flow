import { bitmapLayersForShot } from "../shared/projectOps";
import { activeVisibleBitmapLayerForShot } from "./activeTargets";
import type { Shot } from "../shared/types";

type MaybePromise = void | Promise<unknown>;

type CurrentLayerActionControllerOptions = {
  getPrimarySelectedShot: () => Shot | undefined;
  getBlurRadius: () => number;
  handleBlurBitmapLayer: (shot: Shot, layerId: string, radius: number) => Promise<unknown> | undefined;
  handleClearBitmapLayer: (shotId: string, layerId: string) => MaybePromise;
  setStatus: (status: string) => void;
};

export const createCurrentLayerActionController = ({
  getPrimarySelectedShot,
  getBlurRadius,
  handleBlurBitmapLayer,
  handleClearBitmapLayer,
  setStatus
}: CurrentLayerActionControllerOptions) => {
  const handleClearCurrentLayerFromToolRail = () => {
    const primarySelectedShot = getPrimarySelectedShot();
    if (!primarySelectedShot) {
      setStatus("Select a shot before clearing a layer");
      return;
    }

    const activeLayer = activeVisibleBitmapLayerForShot(primarySelectedShot);
    if (activeLayer) {
      void handleClearBitmapLayer(primarySelectedShot.id, activeLayer.id);
    }
  };

  const handleApplyBlurFromToolRail = async () => {
    const primarySelectedShot = getPrimarySelectedShot();
    if (!primarySelectedShot) {
      setStatus("Select a shot before applying blur");
      return;
    }

    const layers = bitmapLayersForShot(primarySelectedShot);
    const activeLayer =
      layers.find((layer) => layer.id === primarySelectedShot.activeLayerId) ??
      activeVisibleBitmapLayerForShot(primarySelectedShot);
    if (!activeLayer || !activeLayer.visible || activeLayer.locked) {
      setStatus("Select an unlocked visible layer before applying blur");
      return;
    }

    const radius = Math.min(50, Math.max(1, Math.round(getBlurRadius())));
    try {
      const result = await handleBlurBitmapLayer(primarySelectedShot, activeLayer.id, radius);
      if (result !== undefined) {
        setStatus(`Applied ${radius}px Gaussian blur to ${activeLayer.name}`);
      }
    } catch (error) {
      setStatus(`Blur failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    handleApplyBlurFromToolRail,
    handleClearCurrentLayerFromToolRail
  };
};
