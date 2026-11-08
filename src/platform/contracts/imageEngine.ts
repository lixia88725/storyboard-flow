import type { FlowSelection, FlowTransform } from './flowSelection.js';

/** Opaque native layer identity: canonical decimal u64 text, never a JS Number.
 * The document/version identity is supplied by the owning Main Session. */
export type ImageEngineLayerId = string;
export type ImageEngineBlendMode = 'normal' | 'multiply' | 'screen';
export type ImageEngineLayerPatch = {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: ImageEngineBlendMode;
};

/** Product edits only. No filesystem path, native command string, project receipt
 * or caller-selected operation authority. Main retains the complete input before
 * native prepare and alone decides its immutable version in the mixed history.
 *
 * All edits require a settled target; native supplies rollback on failure.
 * opacity is finite 0..1; RGBA channels and tolerance are integers 0..255.
 * Layer sets are bounded, unique and ordered by the captured document stack.
 * Selection geometry is temporary input, not a standalone user Undo step. */
export type ImageEngineEdit =
  | { kind: 'newLayer'; name: string }
  | { kind: 'setLayer'; layerId: ImageEngineLayerId; patch: ImageEngineLayerPatch }
  | { kind: 'setLayerOpacities'; changes: readonly { layerId: ImageEngineLayerId; before: number; opacity: number }[] }
  | { kind: 'removeLayer'; layerId: ImageEngineLayerId }
  | { kind: 'moveLayers'; layerIds: readonly ImageEngineLayerId[]; targetLayerId: ImageEngineLayerId; placement: 'before' | 'after' }
  | { kind: 'clear'; layerId: ImageEngineLayerId }
  | { kind: 'merge'; layerIds: readonly ImageEngineLayerId[] }
  | { kind: 'mergeVisible' }
  | { kind: 'blur'; layerId: ImageEngineLayerId; radius: number; selection?: FlowSelection }
  | { kind: 'fill'; layerId: ImageEngineLayerId; x: number; y: number; color: readonly [number, number, number, number]; tolerance: number }
  | { kind: 'transform'; layerId: ImageEngineLayerId; selection: FlowSelection; matrix: FlowTransform };
