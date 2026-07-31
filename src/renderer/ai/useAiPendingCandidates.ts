import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { windowAiClient, type AiDraftClient } from "./aiClient";

export type AiPendingCandidate = Awaited<ReturnType<AiDraftClient["listCandidates"]>>[number];

const sortCandidates = (candidates: AiPendingCandidate[]): AiPendingCandidate[] =>
  [...candidates].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export const mergeAiPendingCandidates = (
  current: AiPendingCandidate[],
  added: AiPendingCandidate[]
): AiPendingCandidate[] => {
  const byId = new Map(current.map((candidate) => [candidate.id, candidate]));
  added.forEach((candidate) => byId.set(candidate.id, candidate));
  return sortCandidates([...byId.values()]);
};

export const createAiCandidateRequestGate = () => {
  let revision = 0;
  return {
    begin: () => {
      revision += 1;
      return revision;
    },
    invalidate: () => {
      revision += 1;
    },
    isCurrent: (requestRevision: number) => requestRevision === revision
  };
};

export const useAiPendingCandidates = ({
  folderPath,
  setStatus,
  client
}: {
  folderPath: string | undefined;
  setStatus: (status: string) => void;
  client?: AiDraftClient;
}) => {
  const aiClient = useMemo(() => client ?? windowAiClient(), [client]);
  const [candidates, setCandidates] = useState<AiPendingCandidate[]>([]);
  const [candidateFolderPath, setCandidateFolderPath] = useState(folderPath);
  const candidateRequestGateRef = useRef(createAiCandidateRequestGate());

  const refreshCandidates = useCallback(async () => {
    const requestRevision = candidateRequestGateRef.current.begin();
    if (!folderPath) {
      setCandidates([]);
      setCandidateFolderPath(undefined);
      return;
    }
    try {
      const listed = await aiClient.listCandidates(folderPath);
      if (candidateRequestGateRef.current.isCurrent(requestRevision)) {
        setCandidates(listed);
        setCandidateFolderPath(folderPath);
      }
    } catch (error) {
      if (candidateRequestGateRef.current.isCurrent(requestRevision)) {
        setStatus(
          `Could not load AI candidates: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }, [aiClient, folderPath, setStatus]);

  useEffect(() => {
    void refreshCandidates();
  }, [refreshCandidates]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshCandidates();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshCandidates]);

  const addCandidates = useCallback((added: AiPendingCandidate[]) => {
    candidateRequestGateRef.current.invalidate();
    setCandidates((current) => mergeAiPendingCandidates(current, added));
    setCandidateFolderPath(folderPath);
  }, [folderPath]);

  const removeCandidateIds = useCallback((candidateIds: string[]) => {
    candidateRequestGateRef.current.invalidate();
    const removed = new Set(candidateIds);
    setCandidates((current) => current.filter((candidate) => !removed.has(candidate.id)));
  }, []);

  const discardCandidate = useCallback(
    async (candidateId: string) => {
      if (!folderPath) {
        return false;
      }
      try {
        await aiClient.discardCandidate(folderPath, candidateId);
        removeCandidateIds([candidateId]);
        setStatus("AI candidate discarded");
        return true;
      } catch (error) {
        setStatus(
          `Could not discard AI candidate: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return false;
      }
    },
    [aiClient, folderPath, removeCandidateIds, setStatus]
  );

  return {
    addCandidates,
    aiClient,
    candidates: candidateFolderPath === folderPath ? candidates : [],
    discardCandidate,
    refreshCandidates,
    removeCandidateIds
  };
};
