import { useCallback, useState } from "react";
import { toggleAiSidebar, togglePendingSidebar } from "./sidebarState";

export const useExclusiveSidebars = () => {
  const [isParkingShelfOpen, setIsParkingShelfOpen] = useState(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);

  const toggleAiPanel = useCallback(() => {
    const nextState = toggleAiSidebar({
      isAiOpen: isAiPanelOpen,
      isPendingOpen: isParkingShelfOpen
    });
    setIsAiPanelOpen(nextState.isAiOpen);
    setIsParkingShelfOpen(nextState.isPendingOpen);
  }, [isAiPanelOpen, isParkingShelfOpen]);

  const togglePendingShelf = useCallback(() => {
    const nextState = togglePendingSidebar({
      isAiOpen: isAiPanelOpen,
      isPendingOpen: isParkingShelfOpen
    });
    setIsAiPanelOpen(nextState.isAiOpen);
    setIsParkingShelfOpen(nextState.isPendingOpen);
  }, [isAiPanelOpen, isParkingShelfOpen]);

  const openPendingShelf = useCallback(() => {
    setIsAiPanelOpen(false);
    setIsParkingShelfOpen(true);
  }, []);

  return {
    isAiPanelOpen,
    isParkingShelfOpen,
    openPendingShelf,
    toggleAiPanel,
    togglePendingShelf
  };
};
