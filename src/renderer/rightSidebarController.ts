import { useCallback } from "react";
import { useExclusiveSidebars } from "./ai/useExclusiveSidebars";

type MaybeFolderPath = string | undefined;

type AppShellClassNameOptions = {
  isAnimationMode: boolean;
  isParkingShelfOpen: boolean;
  isAiPanelVisible: boolean;
};

export const isAiPanelVisible = ({
  folderPath,
  isAiPanelOpen
}: {
  folderPath: MaybeFolderPath;
  isAiPanelOpen: boolean;
}): boolean => Boolean(folderPath && isAiPanelOpen);

export const appShellClassName = ({
  isAnimationMode,
  isParkingShelfOpen,
  isAiPanelVisible: isAiPanelCurrentlyVisible
}: AppShellClassNameOptions): string =>
  [
    "app-shell",
    isAnimationMode ? "is-animation-mode" : "",
    isParkingShelfOpen ? "has-parking-shelf-open" : "",
    isAiPanelCurrentlyVisible ? "has-ai-panel-open" : ""
  ].filter(Boolean).join(" ");

export const aiPanelToggleStatus = (folderPath: MaybeFolderPath): string | undefined =>
  folderPath ? undefined : "Open a folder before using AI Draft";

export const useRightSidebarController = ({
  folderPath,
  isAnimationMode,
  setStatus
}: {
  folderPath: MaybeFolderPath;
  isAnimationMode: boolean;
  setStatus: (status: string) => void;
}) => {
  const {
    isAiPanelOpen,
    isParkingShelfOpen,
    openPendingShelf,
    toggleAiPanel,
    togglePendingShelf
  } = useExclusiveSidebars();

  const isAiVisible = isAiPanelVisible({ folderPath, isAiPanelOpen });
  const toggleAiPanelForWorkspace = useCallback(() => {
    const unavailableStatus = aiPanelToggleStatus(folderPath);
    if (unavailableStatus) {
      setStatus(unavailableStatus);
      return;
    }

    toggleAiPanel();
  }, [folderPath, setStatus, toggleAiPanel]);

  return {
    appShellClassName: appShellClassName({
      isAnimationMode,
      isParkingShelfOpen,
      isAiPanelVisible: isAiVisible
    }),
    isAiPanelVisible: isAiVisible,
    isParkingShelfOpen,
    openPendingShelf,
    toggleAiPanel: toggleAiPanelForWorkspace,
    togglePendingShelf
  };
};
