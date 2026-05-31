export type DragData =
  | { type: "shot"; shotId: string }
  | { type: "dialogue"; dialogueId: string; shotId: string }
  | { type: "drop-zone"; shotId: string };
