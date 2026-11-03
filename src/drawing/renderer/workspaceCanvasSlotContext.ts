import { createContext } from 'react';
import type { MountedCanvasCheckpoint } from './mountedCanvasRecoveryCapture';
export const WorkspaceCanvasSlotContext = createContext<{ incarnation: object; readonly: boolean; checkpoints?: MountedCanvasCheckpoint[]; pins?: {role:string;dataUrl:string}[] } | undefined>(undefined);
