/** Bounds the checkpoint protocol enforces. FORMAT.md documents the same numbers;
 * keep the two in step when either changes. */
export const LIMITS = {
  /** Largest accepted manifest/version record, in bytes. */
  manifestBytes: 64 * 1024 * 1024,
  /** Largest accepted single PNG asset, in bytes. */
  assetBytes: 512 * 1024 * 1024,
  /** Active plus parked shots. */
  shots: 100_000,
  /** Image documents in one project (retained/unreferenced included). */
  images: 100_000,
  /** Layers in one image document. */
  layersPerImage: 4_096,
  /** Dialogue records in one project. */
  dialogues: 500_000,
  /** Image and layer width/height, in pixels. */
  dimension: 100_000,
  /** Length of any single text field, in UTF-16 code units. */
  textLength: 1_048_576
} as const;
