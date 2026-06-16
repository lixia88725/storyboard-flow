import { activeVisibleBitmapLayerForShot } from "./activeTargets";
import type { Shot } from "../shared/types";

type MaybePromise = void | Promise<unknown>;

type CurrentLayerActionControllerOptions = {
  getPrimarySelectedShot: () => Shot | undefined;
  handleClearBitmapLayer: (shotId: string, layerId: string) => MaybePromise;
  setStatus: (status: string) => void;
};

export const createCurrentLayerActionController = ({
  getPrimarySelectedShot,
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

  return {
    handleClearCurrentLayerFromToolRail
  };
};
