// Classification is not ownership or permission to read paths embedded in XMP.
type Image = { fileName?: string; imagePath: string; width?: number; height?: number; swbMetadata?: unknown };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const isStandaloneLayeredTiffSnapshot = (image: Image): boolean => {
 const metadata = image.swbMetadata;
 return /\.tiff?$/iu.test(image.fileName ?? image.imagePath) && record(metadata) && Array.isArray(metadata.layers) &&
  metadata.layers.some(layer => record(layer) && layer.kind !== "image");
};
// Narrow preview-only permission for an external snapshot in a clean directory.
// The actual Import decoder, not this marker, verifies Photoshop layer channels.
export const isFreshStandaloneLayeredTiffPreview = (image: Image): boolean => {
 const m = image.swbMetadata;
 const dimension = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
 if (!isStandaloneLayeredTiffSnapshot(image) || !record(m) || m.version !== 1 ||
     !["Storyboard Flow", "Storyboard Workbench"].includes(String(m.app)) || m.format !== "swb-tiff" ||
     typeof m.shotId !== "string" || !m.shotId || !dimension(image.width) || !dimension(image.height) ||
     m.canvasWidth !== image.width || m.canvasHeight !== image.height || !Array.isArray(m.layers)) return false;
 const ids = new Set<string>();
 return m.layers.every(layer => {
  if (!record(layer) || typeof layer.id !== "string" || !layer.id || ids.has(layer.id) ||
      !["image", "paint"].includes(String(layer.kind)) || typeof layer.name !== "string" ||
      typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean" ||
      typeof layer.opacity !== "number" || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 ||
      !Number.isSafeInteger(layer.order) ||
      (layer.width !== undefined && layer.width !== image.width) || (layer.height !== undefined && layer.height !== image.height)) return false;
  ids.add(layer.id); return true;
 });
};
