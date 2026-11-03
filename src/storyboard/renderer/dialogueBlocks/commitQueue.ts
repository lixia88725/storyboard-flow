/**
 * One editor's commit bookkeeping, independent of React and of the transport.
 *
 * The host keeps obligations per request; this queue keeps the *intent* side honest:
 *
 * - the newest user intent always owns `sent`, so a stale retry payload can never be replayed;
 * - an older reply may clear neither a newer payload nor the in-flight marker of a newer request;
 * - text that equals the host still goes out while an unconfirmed payload exists — that no-op
 *   commit is what cancels the older obligation;
 * - success clears only the payload it confirmed, failure keeps it retryable.
 *
 * `send` returns whatever the host returned (a promise in production): a promise means the
 * outcome is known, so success clears `sent`; a bare value means confirmation is left to the
 * host's snapshot, which `publish` compares against.
 */
export type SentCommit<P> = { id: number; payload: P; typing: boolean };
export type CommitDelivery<P> = (payload: P, typing: boolean, id: number) => unknown;

export type CommitQueue<P> = {
  /** Deliver the user's newest intent. False when there is nothing to send. */
  publish: (payload: P, typing: boolean, host: P, send: CommitDelivery<P>) => boolean;
  /** Re-offer the unconfirmed payload. Never while a reply is outstanding. */
  retry: (host: P, send: CommitDelivery<P>) => boolean;
  settle: (id: number, ok: boolean) => void;
  reset: () => void;
  unconfirmed: () => SentCommit<P> | null;
  waiting: () => number | null;
};

export function createCommitQueue<P>(same: (a: P, b: P) => boolean): CommitQueue<P> {
  let nextId = 1;
  let sent: SentCommit<P> | null = null;
  // A promise may settle before React renders the corresponding host snapshot. Retain the
  // last delivered intent separately from the retry slot so a stale host cannot swallow a revert.
  let lastDelivered: { payload: P } | null = null;
  let inFlight: number | null = null;

  const deliver = (payload: P, typing: boolean, send: CommitDelivery<P>) => {
    const id = nextId++;
    sent = { id, payload, typing };
    lastDelivered = { payload };
    const result = send(payload, typing, id);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      inFlight = id;
      const done = (ok: boolean) => {
        if (inFlight === id) inFlight = null;
        // Only the newest payload may be cleared: an older reply must not erase a newer intent.
        if (ok && sent && sent.id === id) sent = null;
      };
      void (result as Promise<unknown>).then(() => done(true), () => done(false));
    }
    return id;
  };

  return {
    publish(payload, typing, host, send) {
      // Nothing was ever offered and the text is already the host's: an empty commit would only
      // push history.
      if (!sent && same(payload, host) && (!lastDelivered || same(payload, lastDelivered.payload))) return false;
      // The same payload is already outstanding (in flight or failed): blur retries it, and a
      // second identical request would only queue behind the first.
      if (sent && same(payload, sent.payload)) return false;
      deliver(payload, typing, send);
      return true;
    },
    retry(host, send) {
      if (!sent || inFlight !== null) return false;
      // `host` is accepted for symmetry with publish; an unconfirmed payload is always
      // re-offered, even when it already matches the host — that is the cancel commit.
      deliver(sent.payload, sent.typing, send);
      return true;
    },
    settle(id, ok) {
      if (inFlight === id) inFlight = null;
      if (ok && sent && sent.id === id) sent = null;
    },
    reset() {
      sent = null;
      inFlight = null;
      lastDelivered = null;
    },
    unconfirmed: () => sent,
    waiting: () => inFlight
  };
}
