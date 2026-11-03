/**
 * Host-owned state for dialogue text that is not safely in the project yet.
 *
 * Two obligations live here and only here:
 * - a mounted editor is composing (IME candidates are local to its textarea);
 * - a `setDialogues` request the host issued has not succeeded yet.
 *
 * Commit obligations are per request, not one global flag: a success may only release the text
 * that request installed. A rejected or in-flight request keeps its board held (card mounted and
 * editor not ended) so the text stays on screen and can be retried; only a later request for the
 * same board supersedes it. Unmounting an editor releases composition only, never a commit.
 */

export type DialogueEditState = { shotId: string; composing: boolean };

type Obligation = { id: number; shotId: string; owner: string };

export type DialogueCommitState = {
  /** Per mounted editor: composition started/ended, or the editor went away. */
  report(instanceId: string, state: DialogueEditState | null): void;
  /**
   * `owner` is the editor instance that produced the text. Two editors can edit the same board
   * (info panel and dialogue track); one editor's success must not release the other's text.
   */
  begin(shotId: string, owner: string): number;
  /**
   * `ok=false` keeps this obligation, so the failure cannot be cleared by an unrelated success.
   * `ok=true` releases it and every earlier obligation **of the same editor** for the same board
   * (that editor's newer text supersedes its own older text). Other editors' obligations and
   * any of this editor's later obligations stay: their payload may hold text this success did
   * not install.
   */
  settle(id: number, ok: boolean): void;
  busy(): boolean;
  composingShots(): string[];
  /** Every board that must stay mounted: composing boards plus all unsettled boards. */
  holdShots(): string[];
  reset(): void;
};

export function createDialogueCommitState(): DialogueCommitState {
  const composing = new Map<string, string>();
  let obligations: Obligation[] = [];
  let serial = 0;
  const composingShots = () => [...new Set(composing.values())];
  const holdShots = () => [...new Set([...composing.values(), ...obligations.map(item => item.shotId)])];
  return {
    report(instanceId, state) {
      if (state && state.composing) composing.set(instanceId, state.shotId);
      else composing.delete(instanceId);
    },
    begin(shotId, owner) {
      const id = ++serial;
      obligations = [...obligations, { id, shotId, owner }];
      return id;
    },
    settle(id, ok) {
      const settled = obligations.find(item => item.id === id);
      if (!settled || !ok) return;
      obligations = obligations.filter(item => !(item.owner === settled.owner && item.id <= id));
    },
    busy: () => composing.size > 0 || obligations.length > 0,
    composingShots,
    holdShots,
    reset() {
      composing.clear();
      obligations = [];
    }
  };
}
