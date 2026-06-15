import { useCallback, useEffect, type MutableRefObject } from "react";

type HistoryStackUpdate<T> = T[] | ((current: T[]) => T[]);
type StateSetter<T> = (value: T[]) => void;

export const applyHistoryStackUpdate = <T>(
  current: T[],
  update: HistoryStackUpdate<T>
): T[] => (typeof update === "function" ? update(current) : update);

export const createSyncedHistoryStackSetter =
  <T>(stackRef: MutableRefObject<T[]>, setStack: StateSetter<T>) =>
  (update: HistoryStackUpdate<T>) => {
    const next = applyHistoryStackUpdate(stackRef.current, update);
    stackRef.current = next;
    setStack(next);
  };

export const useSyncedHistoryStackController = <T>({
  stack,
  stackRef,
  setStack
}: {
  stack: T[];
  stackRef: MutableRefObject<T[]>;
  setStack: StateSetter<T>;
}) => {
  useEffect(() => {
    stackRef.current = stack;
  }, [stack, stackRef]);

  return useCallback(
    createSyncedHistoryStackSetter(stackRef, setStack),
    [setStack, stackRef]
  );
};
