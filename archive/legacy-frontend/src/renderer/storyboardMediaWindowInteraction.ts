export type StoryboardMediaWindowInteractionLease = {
  release: () => void;
};

export type StoryboardMediaWindowInteractionController = {
  beginInteraction: () => StoryboardMediaWindowInteractionLease;
  isInteractionActive: () => boolean;
  subscribe: (listener: (isActive: boolean) => void) => () => void;
};

export const createStoryboardMediaWindowInteractionController =
  (): StoryboardMediaWindowInteractionController => {
    const activeLeases = new Set<symbol>();
    const listeners = new Set<(isActive: boolean) => void>();

    const notify = (isActive: boolean) => {
      listeners.forEach((listener) => listener(isActive));
    };

    return {
      beginInteraction() {
        const leaseId = Symbol("storyboard-media-window-interaction");
        const wasActive = activeLeases.size > 0;
        activeLeases.add(leaseId);
        if (!wasActive) {
          notify(true);
        }
        let released = false;
        return {
          release() {
            if (released) {
              return;
            }
            released = true;
            activeLeases.delete(leaseId);
            if (activeLeases.size === 0) {
              notify(false);
            }
          }
        };
      },
      isInteractionActive: () => activeLeases.size > 0,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  };

export type StoryboardMediaVisibility = {
  isWarm: boolean;
  isHot: boolean;
};

type VisibilityListener = (visibility: StoryboardMediaVisibility) => void;

type AnimationFrameScheduler = Pick<Window, "cancelAnimationFrame" | "requestAnimationFrame">;

type VisibilityRegistration = {
  element: Element;
  listener: VisibilityListener;
  visibility: StoryboardMediaVisibility;
  deliveredVisibility: StoryboardMediaVisibility;
};

export const STORYBOARD_MEDIA_RECONCILE_BATCH_SIZE = 6;

const sameVisibility = (
  a: StoryboardMediaVisibility,
  b: StoryboardMediaVisibility
): boolean => a.isWarm === b.isWarm && a.isHot === b.isHot;

const reconcilePriority = (registration: VisibilityRegistration): number => {
  if (registration.deliveredVisibility.isHot && !registration.visibility.isHot) {
    return 0;
  }
  if (!registration.deliveredVisibility.isHot && registration.visibility.isHot) {
    return 1;
  }
  return 2;
};

export type StoryboardMediaVisibilityDispatcher = {
  observe: (element: Element, listener: VisibilityListener) => () => void;
  updateVisibility: (
    element: Element,
    patch: Partial<StoryboardMediaVisibility>
  ) => void;
  cancelReconciliation: () => void;
  dispose: () => void;
};

export const createStoryboardMediaVisibilityDispatcher = ({
  interactionController,
  scheduler,
  batchSize = STORYBOARD_MEDIA_RECONCILE_BATCH_SIZE
}: {
  interactionController: StoryboardMediaWindowInteractionController;
  scheduler: AnimationFrameScheduler;
  batchSize?: number;
}): StoryboardMediaVisibilityDispatcher => {
  const registrations = new Map<Element, VisibilityRegistration>();
  let reconcileFrame: number | undefined;
  let isReconciling = false;
  let disposed = false;

  const cancelReconciliation = () => {
    if (reconcileFrame !== undefined) {
      scheduler.cancelAnimationFrame(reconcileFrame);
      reconcileFrame = undefined;
    }
    isReconciling = false;
  };

  const deliver = (registration: VisibilityRegistration) => {
    if (registrations.get(registration.element) !== registration) {
      return;
    }
    registration.deliveredVisibility = registration.visibility;
    registration.listener(registration.visibility);
  };

  const hasPendingVisibility = () =>
    [...registrations.values()].some(
      (registration) =>
        !sameVisibility(registration.visibility, registration.deliveredVisibility)
    );

  const scheduleReconciliation = () => {
    if (
      disposed ||
      interactionController.isInteractionActive() ||
      reconcileFrame !== undefined ||
      !hasPendingVisibility()
    ) {
      return;
    }
    isReconciling = true;
    reconcileFrame = scheduler.requestAnimationFrame(() => {
      reconcileFrame = undefined;
      const pending = [...registrations.values()]
        .filter(
          (registration) =>
            !sameVisibility(registration.visibility, registration.deliveredVisibility)
        )
        .sort((a, b) => reconcilePriority(a) - reconcilePriority(b));
      pending.slice(0, batchSize).forEach(deliver);

      if (hasPendingVisibility()) {
        scheduleReconciliation();
      } else {
        isReconciling = false;
      }
    });
  };

  const unsubscribeInteraction = interactionController.subscribe((isActive) => {
    if (isActive) {
      cancelReconciliation();
      return;
    }
    scheduleReconciliation();
  });

  return {
    observe(element, listener) {
      registrations.set(element, {
        element,
        listener,
        visibility: { isWarm: false, isHot: false },
        deliveredVisibility: { isWarm: false, isHot: false }
      });
      return () => {
        registrations.delete(element);
      };
    },
    updateVisibility(element, patch) {
      const registration = registrations.get(element);
      if (!registration) {
        return;
      }
      registration.visibility = { ...registration.visibility, ...patch };
      if (interactionController.isInteractionActive() || isReconciling) {
        scheduleReconciliation();
        return;
      }
      if (!sameVisibility(registration.visibility, registration.deliveredVisibility)) {
        deliver(registration);
      }
    },
    cancelReconciliation,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelReconciliation();
      unsubscribeInteraction();
      registrations.clear();
    }
  };
};
