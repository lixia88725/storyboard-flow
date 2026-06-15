import type { Dispatch, RefObject, SetStateAction } from "react";
import { usePopoverController } from "./popoverController";

export type WorkspaceMenuState = {
  isAddShotMenuOpen: boolean;
  isImportHelpOpen: boolean;
  isRecentMenuOpen: boolean;
  isSaveMenuOpen: boolean;
};

export type WorkspaceMenuController = WorkspaceMenuState & {
  addShotMenuRef: RefObject<HTMLDivElement | null>;
  importHelpRef: RefObject<HTMLDivElement | null>;
  recentMenuRef: RefObject<HTMLDivElement | null>;
  saveMenuRef: RefObject<HTMLDivElement | null>;
  setIsAddShotMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportHelpOpen: Dispatch<SetStateAction<boolean>>;
  setIsRecentMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsSaveMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export const hasOpenWorkspaceMenu = ({
  isAddShotMenuOpen,
  isImportHelpOpen,
  isRecentMenuOpen,
  isSaveMenuOpen
}: WorkspaceMenuState): boolean =>
  isAddShotMenuOpen || isImportHelpOpen || isRecentMenuOpen || isSaveMenuOpen;

export const useWorkspaceMenuController = (): WorkspaceMenuController => {
  const {
    isOpen: isSaveMenuOpen,
    setIsOpen: setIsSaveMenuOpen,
    ref: saveMenuRef
  } = usePopoverController<HTMLDivElement>();
  const {
    isOpen: isRecentMenuOpen,
    setIsOpen: setIsRecentMenuOpen,
    ref: recentMenuRef
  } = usePopoverController<HTMLDivElement>();
  const {
    isOpen: isAddShotMenuOpen,
    setIsOpen: setIsAddShotMenuOpen,
    ref: addShotMenuRef
  } = usePopoverController<HTMLDivElement>();
  const {
    isOpen: isImportHelpOpen,
    setIsOpen: setIsImportHelpOpen,
    ref: importHelpRef
  } = usePopoverController<HTMLDivElement>();

  return {
    addShotMenuRef,
    importHelpRef,
    isAddShotMenuOpen,
    isImportHelpOpen,
    isRecentMenuOpen,
    isSaveMenuOpen,
    recentMenuRef,
    saveMenuRef,
    setIsAddShotMenuOpen,
    setIsImportHelpOpen,
    setIsRecentMenuOpen,
    setIsSaveMenuOpen
  };
};
