import { useCallback, useState } from "react";

type AppShellClassNameOptions = {
  isAnimationMode: boolean;
  isParkingShelfOpen: boolean;
};

export const appShellClassName = ({ isAnimationMode, isParkingShelfOpen }: AppShellClassNameOptions): string =>
  ["app-shell", isAnimationMode ? "is-animation-mode" : "", isParkingShelfOpen ? "has-parking-shelf-open" : ""]
    .filter(Boolean).join(" ");

export const useRightSidebarController = ({ isAnimationMode }: { isAnimationMode: boolean }) => {
  const [isParkingShelfOpen, setIsParkingShelfOpen] = useState(false);
  const openPendingShelf = useCallback(() => setIsParkingShelfOpen(true), []);
  const togglePendingShelf = useCallback(() => setIsParkingShelfOpen(open => !open), []);
  return {
    appShellClassName: appShellClassName({ isAnimationMode, isParkingShelfOpen }),
    isParkingShelfOpen,
    openPendingShelf,
    togglePendingShelf
  };
};
