export type BitmapBlendMode = "normal" | "multiply" | "screen";

export type BitmapLayer = {
  id: string;
  kind: "image" | "paint";
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BitmapBlendMode;
  order: number;
  bitmapPath: string;
  width: number;
  height: number;
  cleared?: boolean;
};

export type Shot = {
  id: string;
  imagePath: string;
  previewPath?: string;
  fileName: string;
  order: number;
  scriptText?: string;
  layers?: BitmapLayer[];
  activeLayerId?: string;
  swb?: {
    canvasWidth: number;
    canvasHeight: number;
  };
};

export type Project = {
  id: string;
  name: string;
  ai?: {
    projectContext?: string;
  };
  shots: Shot[];
  parkedShots?: Shot[];
  dialogues: Array<{
    id: string;
    shotId: string;
    text: string;
    order: number;
  }>;
  createdAt: string;
  updatedAt: string;
};
