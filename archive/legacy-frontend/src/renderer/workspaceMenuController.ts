import type { Dispatch, RefObject, SetStateAction } from "react";
import { usePopoverController } from "./popoverController";

export type WorkspaceMenuState = {
  isAddShotMenuOpen: boolean;
  isImportHelpOpen: boolean;
  isMatteMenuOpen: boolean;
  isRecentMenuOpen: boolean;
  isSaveMenuOpen: boolean;
};

export type WorkspaceMenuController = WorkspaceMenuState & {
  addShotMenuRef: RefObject<HTMLDivElement | null>;
  importHelpRef: RefObject<HTMLDivElement | null>;
  matteMenuRef: RefObject<HTMLDivElement | null>;
  recentMenuRef: RefObject<HTMLDivElement | null>;
  saveMenuRef: RefObject<HTMLDivElement | null>;
  setIsAddShotMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportHelpOpen: Dispatch<SetStateAction<boolean>>;
  setIsMatteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsRecentMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsSaveMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export const hasOpenWorkspaceMenu = ({
  isAddShotMenuOpen,
  isImportHelpOpen,
  isMatteMenuOpen,
  isRecentMenuOpen,
  isSaveMenuOpen
}: Omit<WorkspaceMenuState, "isMatteMenuOpen"> & {
  isMatteMenuOpen?: boolean;
}): boolean =>
  isAddShotMenuOpen ||
  isImportHelpOpen ||
  isMatteMenuOpen ||
  isRecentMenuOpen ||
  isSaveMenuOpen;

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
  const {
    isOpen: isMatteMenuOpen,
    setIsOpen: setIsMatteMenuOpen,
    ref: matteMenuRef
  } = usePopoverController<HTMLDivElement>();

  return {
    addShotMenuRef,
    importHelpRef,
    isAddShotMenuOpen,
    isImportHelpOpen,
    isMatteMenuOpen,
    isRecentMenuOpen,
    isSaveMenuOpen,
    matteMenuRef,
    recentMenuRef,
    saveMenuRef,
    setIsAddShotMenuOpen,
    setIsImportHelpOpen,
    setIsMatteMenuOpen,
    setIsRecentMenuOpen,
    setIsSaveMenuOpen
  };
};
