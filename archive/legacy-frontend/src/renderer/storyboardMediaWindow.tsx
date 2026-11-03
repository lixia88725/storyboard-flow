import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import {
  createStoryboardMediaVisibilityDispatcher,
  type StoryboardMediaVisibility,
  type StoryboardMediaWindowInteractionController
} from "./storyboardMediaWindowInteraction";

export type StoryboardMediaTier = "cold" | "warm" | "hot";

type VisibilityListener = (visibility: StoryboardMediaVisibility) => void;

type StoryboardMediaWindowContextValue = {
  observe: (element: Element, listener: VisibilityListener) => () => void;
};

const StoryboardMediaWindowContext =
  createContext<StoryboardMediaWindowContextValue | undefined>(undefined);

export const storyboardMediaTierForVisibility = ({
  isWarm,
  isHot,
  pinned
}: StoryboardMediaVisibility & {
  pinned: boolean;
}): StoryboardMediaTier => {
  if (pinned || isHot) {
    return "hot";
  }
  return isWarm ? "warm" : "cold";
};

export const shouldMountStoryboardEditor = (tier: StoryboardMediaTier): boolean =>
  tier === "hot";

export const StoryboardMediaWindowProvider = ({
  children,
  interactionController,
  rootRef,
  scopeKey
}: {
  children: ReactNode;
  interactionController: StoryboardMediaWindowInteractionController;
  rootRef: RefObject<HTMLElement | null>;
  scopeKey: string;
}) => {
  const warmObserverRef = useRef<IntersectionObserver | undefined>(undefined);
  const hotObserverRef = useRef<IntersectionObserver | undefined>(undefined);
  const observedElementsRef = useRef(new Set<Element>());
  const visibilityDispatcher = useMemo(
    () =>
      createStoryboardMediaVisibilityDispatcher({
        interactionController,
        scheduler: window
      }),
    [interactionController]
  );

  const observe = useCallback((element: Element, listener: VisibilityListener) => {
    const stopObservingVisibility = visibilityDispatcher.observe(element, listener);
    observedElementsRef.current.add(element);
    warmObserverRef.current?.observe(element);
    hotObserverRef.current?.observe(element);

    return () => {
      stopObservingVisibility();
      observedElementsRef.current.delete(element);
      warmObserverRef.current?.unobserve(element);
      hotObserverRef.current?.unobserve(element);
    };
  }, [visibilityDispatcher]);

  useEffect(() => {
    const updateVisibility = (
      element: Element,
      patch: Partial<StoryboardMediaVisibility>
    ) => visibilityDispatcher.updateVisibility(element, patch);
    const warmObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          updateVisibility(entry.target, { isWarm: entry.isIntersecting });
        }
      },
      {
        root: rootRef.current,
        rootMargin: "100% 0px",
        threshold: 0
      }
    );
    const hotObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          updateVisibility(entry.target, { isHot: entry.isIntersecting });
        }
      },
      {
        root: rootRef.current,
        rootMargin: "25% 0px",
        threshold: 0
      }
    );
    warmObserverRef.current = warmObserver;
    hotObserverRef.current = hotObserver;
    observedElementsRef.current.forEach((element) => {
      warmObserver.observe(element);
      hotObserver.observe(element);
    });

    return () => {
      warmObserver.disconnect();
      hotObserver.disconnect();
      warmObserverRef.current = undefined;
      hotObserverRef.current = undefined;
      visibilityDispatcher.cancelReconciliation();
    };
  }, [rootRef, scopeKey, visibilityDispatcher]);

  useEffect(() => () => visibilityDispatcher.dispose(), [visibilityDispatcher]);
  const value = useMemo(() => ({ observe }), [observe]);

  return (
    <StoryboardMediaWindowContext.Provider value={value}>
      {children}
    </StoryboardMediaWindowContext.Provider>
  );
};

export const useStoryboardMediaWindow = (
  elementRef: RefObject<Element | null>,
  pinned: boolean
): StoryboardMediaTier => {
  const context = useContext(StoryboardMediaWindowContext);
  const [visibility, setVisibility] = useState<StoryboardMediaVisibility>({
    isWarm: false,
    isHot: false
  });

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !context) {
      setVisibility({ isWarm: true, isHot: true });
      return;
    }

    return context.observe(element, setVisibility);
  }, [context, elementRef]);

  return storyboardMediaTierForVisibility({ ...visibility, pinned });
};
