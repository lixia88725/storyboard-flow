import { useEffect, useRef, useState } from "react";

type PopoverContainer<Target> = {
  contains: (target: Target) => boolean;
};

export const shouldDismissPopover = <Target>(
  container: PopoverContainer<Target> | null | undefined,
  target: Target
): boolean => !container || !container.contains(target);

export const usePopoverController = <T extends HTMLElement>() => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      if (shouldDismissPopover(ref.current, event.target as Node | null)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return {
    isOpen,
    setIsOpen,
    ref
  };
};
